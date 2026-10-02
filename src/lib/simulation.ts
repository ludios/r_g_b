// Model-output: Claude Opus 5.5

// The simulation on the GPU: ping-pong buffers, the step shader, and drawing to the canvas.
import * as THREE from "three";
import type { Kernel } from "./kernel";
import { type Seeds, VIEWS, type View } from "./settings";
import screen_shader from "./screen.frag?raw";
import sim_shader from "./sim.frag?raw";

/** How far a planted wave's stripes swing from the ground. */
const WAVE = 0.05;

/** What a restart starts from. */
export interface StartSettings {
	/** The buffers' size in pixels. */
	width: number;
	height: number;
	/** The gray the buffers start as, 0 to 1. */
	ground: number;
	/** How far each channel of each pixel starts from the ground, at most. */
	noise: number;
	seeds: Seeds;
	/** Whether the buffers hold half floats rather than bytes, which round to 1/255. */
	float: boolean;
	/** Faint stripes to start with, in cycles per pixel across and up, if any. */
	wave?: { fx: number; fy: number };
}

/** What one step of the simulation does, besides convolving with the kernel. */
export interface StepSettings {
	kernel: Kernel;
	/** Whether to stamp the seeds again. */
	stamp: boolean;
	/** The distance between neighboring taps, in buffer pixels. */
	tap_spacing: number;
	/** How far each pixel's tap spacing is scaled from 1, at most. */
	jitter: number;
	/** How much of the previous frame to keep, 0 to 1. */
	persistence: number;
}

/**
 * Draws the seeds: one dot or three (R, G, B at 1/6, 1/2, 5/6 along the longer axis), solid out to
 * r=2 and fading to transparent by r=10; or a single white pixel in the middle; or nothing.
 * @param w The canvas's width in pixels.
 * @param h The canvas's height in pixels.
 */
function draw_seeds(ctx: CanvasRenderingContext2D, w: number, h: number, seeds: Seeds): void {
	if (seeds === "pixel") {
		ctx.fillStyle = "#fff";
		ctx.fillRect(Math.floor(w / 2), Math.floor(h / 2), 1, 1);
		return;
	}
	const dots = seeds === "rgb" ? [["#f00", 1 / 6], ["#0f0", 3 / 6], ["#00f", 5 / 6]] as const
		: seeds === "white" ? [["#fff", 1 / 2]] as const
		: [];
	for (const [color, along] of dots) {
		const [x, y] = w >= h
			? [Math.round(along * w), Math.round(h / 2)]
			: [Math.round(w / 2), Math.round(along * h)];
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, 10);
		gradient.addColorStop(0, color);
		gradient.addColorStop(0.2, color);
		gradient.addColorStop(1, color + "0"); // "#f000" is transparent red
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, 10, 0, 2 * Math.PI);
		ctx.fill();
	}
}

/**
 * Each step draws a full-screen quad into a buffer, convolving the previous one; then another
 * quad shows it on the canvas. Taps wrap around the edges, so the screen is a torus.
 */
export class Simulation {
	readonly renderer: THREE.WebGLRenderer;
	#camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	// The material keeps this object, so setting a value here sets the uniform.
	#sim_uniforms = {
		res:         { value: new THREE.Vector2() },
		prev_frame:  { value: null as THREE.Texture | null },
		seeds:       { value: null as THREE.Texture | null },
		stamp:       { value: true },
		kernel:      { value: [] as number[] },
		tap_spacing: { value: 0 },
		jitter:      { value: 0 },
		persistence: { value: 0 },
		starting:    { value: false },
		ground:      { value: 0 },
		noise:       { value: 0 },
		wave:        { value: new THREE.Vector3() },
		painting:    { value: false },
		stroke:      { value: new THREE.Vector4() },
		brush:       { value: 0 },
		paint:       { value: new THREE.Color() },
	};
	#screen_uniforms = {
		current:  { value: null as THREE.Texture | null },
		previous: { value: null as THREE.Texture | null },
		view:     { value: 0 },
	};
	#screen_scene: THREE.Scene;
	#sim_scene:    THREE.Scene;
	// Ping-pong buffers; current holds the latest frame. restart() sizes them.
	#current:      THREE.WebGLRenderTarget;
	#next:         THREE.WebGLRenderTarget;
	#seed_texture: THREE.CanvasTexture | undefined;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas });
		this.renderer.autoClear = false; // Every draw covers the whole target
		// Colors are plain 0-1 values, with no sRGB conversions, as in old three.js.
		THREE.ColorManagement.enabled = false;
		this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

		const quad = new THREE.PlaneGeometry(2, 2);
		const sim_material = new THREE.ShaderMaterial({ uniforms: this.#sim_uniforms, fragmentShader: sim_shader });
		this.#sim_scene    = new THREE.Scene().add(new THREE.Mesh(quad, sim_material));
		const screen_material = new THREE.ShaderMaterial({ uniforms: this.#screen_uniforms, fragmentShader: screen_shader });
		this.#screen_scene = new THREE.Scene().add(new THREE.Mesh(quad, screen_material));

		this.#current = Simulation.#target(false);
		this.#next    = Simulation.#target(false);
	}

	/** A buffer for restart() to size. */
	static #target(float: boolean): THREE.WebGLRenderTarget {
		// The step reads whole texels itself; showing a buffer on the canvas never blends them.
		return new THREE.WebGLRenderTarget(1, 1, {
			type:          float ? THREE.HalfFloatType : THREE.UnsignedByteType,
			minFilter:     THREE.NearestFilter,
			magFilter:     THREE.NearestFilter,
			depthBuffer:   false,
			stencilBuffer: false,
		});
	}

	/** (Re)starts the simulation from the ground, noise and seeds; the canvas's own size is left to CSS. */
	restart(start: StartSettings): void {
		const { width, height } = start;
		this.renderer.setSize(width, height, false);

		const seed_canvas = document.createElement("canvas");
		seed_canvas.width = width;
		seed_canvas.height = height;
		draw_seeds(seed_canvas.getContext("2d")!, width, height, start.seeds);
		this.#seed_texture?.dispose();
		this.#seed_texture = new THREE.CanvasTexture(seed_canvas);
		this.#seed_texture.minFilter = THREE.LinearFilter;

		// Freed here (along with anything left from a lost context); reallocated on first use.
		this.#current.dispose();
		this.#next.dispose();
		if ((this.#current.texture.type === THREE.HalfFloatType) !== start.float) {
			this.#current = Simulation.#target(start.float);
			this.#next    = Simulation.#target(start.float);
		}
		this.#current.setSize(width, height);
		this.#next.setSize(width, height);

		const u = this.#sim_uniforms;
		u.res.value.set(width, height);
		u.seeds.value  = this.#seed_texture;
		u.ground.value = start.ground;
		u.noise.value  = start.noise;
		// Whole cycles across the buffers, so the stripes meet themselves where the screen wraps.
		const fx = Math.round((start.wave?.fx ?? 0) * width) / width;
		const fy = Math.round((start.wave?.fy ?? 0) * height) / height;
		u.wave.value.set(fx, fy, start.wave === undefined ? 0 : WAVE);
		// Both buffers, so that the first step's change is from the start. Nothing is read, but the
		// last frame's texture must not stay bound while it's drawn into: a feedback loop to WebGL.
		u.prev_frame.value = null;
		u.starting.value = true;
		for (const target of [this.#current, this.#next]) {
			this.renderer.setRenderTarget(target);
			this.renderer.render(this.#sim_scene, this.#camera);
		}
		u.starting.value = false;
	}

	/** Runs one step of the simulation. */
	step(settings: StepSettings): void {
		const u = this.#sim_uniforms;
		u.prev_frame.value  = this.#current.texture;
		u.kernel.value      = settings.kernel;
		u.stamp.value       = settings.stamp;
		u.tap_spacing.value = settings.tap_spacing;
		u.jitter.value      = settings.jitter;
		u.persistence.value = settings.persistence;

		this.renderer.setRenderTarget(this.#next);
		this.renderer.render(this.#sim_scene, this.#camera);
		[this.#current, this.#next] = [this.#next, this.#current];
	}

	/**
	 * Paints a stroke into the latest frame. Like a step, it makes a new frame, so the one before is
	 * the frame without the stroke.
	 * @param from The stroke's start, in pixels from the bottom left.
	 * @param to Its end.
	 * @param radius In pixels.
	 * @param color "#rrggbb".
	 */
	paint(from: { x: number; y: number }, to: { x: number; y: number }, radius: number, color: string): void {
		const u = this.#sim_uniforms;
		u.prev_frame.value = this.#current.texture;
		u.stroke.value.set(from.x, from.y, to.x, to.y);
		u.brush.value = radius;
		u.paint.value.set(color);
		u.painting.value = true;
		this.renderer.setRenderTarget(this.#next);
		this.renderer.render(this.#sim_scene, this.#camera);
		u.painting.value = false;
		[this.#current, this.#next] = [this.#next, this.#current];
	}

	/** Shows the latest frame on the canvas. */
	draw(view: View): void {
		this.#screen_uniforms.current.value  = this.#current.texture;
		this.#screen_uniforms.previous.value = this.#next.texture;
		this.#screen_uniforms.view.value     = VIEWS.indexOf(view);
		this.renderer.setRenderTarget(null);
		this.renderer.render(this.#screen_scene, this.#camera);
	}
}
