// Model-output: Claude Opus 5.5

// The simulation on the GPU: ping-pong buffers, the step shader, and drawing to the canvas.
import * as THREE from "three";
import type { Kernel } from "./kernel";
import sim_shader from "./sim.frag?raw";

/** Fresh buffers' color. On black, a red dot would grow red/black stripes; on gray it dips G and B too. */
const GRAY = 0.05;

/** What one step of the simulation does, besides convolving with the kernel. */
export interface StepSettings {
	kernel: Kernel;
	/** The distance between neighboring taps, in buffer pixels. */
	tap_spacing: number;
	/** How much of the previous frame to keep, 0 to 1. */
	persistence: number;
}

/**
 * Draws the seed dots: R, G, B at 1/6, 1/2, 5/6 along the longer axis, solid out to r=2 and
 * fading to transparent by r=10.
 * @param w The canvas's width in pixels.
 * @param h The canvas's height in pixels.
 */
function draw_seeds(ctx: CanvasRenderingContext2D, w: number, h: number): void {
	for (const [color, along] of [["#f00", 1 / 6], ["#0f0", 3 / 6], ["#00f", 5 / 6]] as const) {
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
		kernel:      { value: [] as number[] },
		tap_spacing: { value: 0 },
		persistence: { value: 0 },
	};
	#screen_material = new THREE.MeshBasicMaterial();
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
		this.#screen_scene = new THREE.Scene().add(new THREE.Mesh(quad, this.#screen_material));

		// The step reads whole texels itself; showing a buffer on the canvas never blends them.
		const target_options = {
			minFilter:     THREE.NearestFilter,
			magFilter:     THREE.NearestFilter,
			depthBuffer:   false,
			stencilBuffer: false,
		};
		this.#current = new THREE.WebGLRenderTarget(1, 1, target_options);
		this.#next = new THREE.WebGLRenderTarget(1, 1, target_options);
	}

	/**
	 * (Re)starts the simulation from just the seeds; the canvas's own size is left to CSS.
	 * @param width The buffers' width in pixels.
	 * @param height The buffers' height in pixels.
	 */
	restart(width: number, height: number): void {
		this.renderer.setSize(width, height, false);

		const seed_canvas = document.createElement("canvas");
		seed_canvas.width = width;
		seed_canvas.height = height;
		draw_seeds(seed_canvas.getContext("2d")!, width, height);
		this.#seed_texture?.dispose();
		this.#seed_texture = new THREE.CanvasTexture(seed_canvas);
		this.#seed_texture.minFilter = THREE.LinearFilter;

		// Freed here (along with anything left from a lost context); reallocated on first use.
		this.#current.dispose();
		this.#next.dispose();
		this.#current.setSize(width, height);
		this.#next.setSize(width, height);
		this.renderer.setRenderTarget(this.#current);
		this.renderer.setClearColor(new THREE.Color(GRAY, GRAY, GRAY));
		this.renderer.clear();

		this.#sim_uniforms.res.value.set(width, height);
		this.#sim_uniforms.seeds.value = this.#seed_texture;
	}

	/** Runs one step of the simulation and shows the result. */
	step(settings: StepSettings): void {
		const u = this.#sim_uniforms;
		u.prev_frame.value = this.#current.texture;
		u.kernel.value = settings.kernel;
		u.tap_spacing.value = settings.tap_spacing;
		u.persistence.value = settings.persistence;

		this.renderer.setRenderTarget(this.#next);
		this.renderer.render(this.#sim_scene, this.#camera);
		[this.#current, this.#next] = [this.#next, this.#current];

		this.#screen_material.map = this.#current.texture;
		this.renderer.setRenderTarget(null);
		this.renderer.render(this.#screen_scene, this.#camera);
	}
}
