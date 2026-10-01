// Model-output: Claude Opus 5.5
//
// Based on https://github.com/samhains/minimal-threejs-feedback-glsl/blob/master/index.html
//
// Feedback loop: each frame convolves the previous one with a random 5x5 kernel and clamps to [0, 1].
// The kernel sums to 1, so flat areas stay flat, but it amplifies some spatial frequencies; those grow
// every frame until the clamp saturates them, leaving stripes a few tap spacings apart. Lopsided
// kernels make them drift; negative gain makes them invert every frame (the strobing).
//
// R, G and B are three independent simulations sharing the kernel. Each saturates to 0 or 1, hence
// mostly black, white, R, G, B, C, M and Y.
//
// The only seeds are three dots, re-stamped every frame, on a 0.05 gray background. Relative to that
// gray, the red dot is +0.95 in R but -0.05 in G and B, so G and B grow roughly the inverse of R's
// pattern: red/cyan stripes (likewise green/magenta, blue/yellow). On black there'd be no dip, just
// red/black.
//
// Mouse X: kernel contrast. Mouse Y: tap spacing; near the bottom it also keeps more of the previous
// frame, freezing at the very bottom. Click/tap: new kernel (one is also crossfaded in every minute).
// Space: pause. Enter (while paused): single step.

import * as THREE from "three";
import sim_shader from "./sim.frag?raw";

const KERNEL_FADE_MS = 60 * 1000;
const GRAY = 0.05; // Fresh buffers' color; see the top comment for why not black

/** The pointer's position as a fraction of the window, 0 at the top left. */
let mouse_x = 0.5;
let mouse_y = 0.5;

const renderer = new THREE.WebGLRenderer();
renderer.autoClear = false; // Every draw covers the whole target
// Colors are plain 0-1 values, with no sRGB conversions, as in old three.js.
THREE.ColorManagement.enabled = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Each frame draws a full-screen quad into a buffer (one simulation step), then another to
// the screen.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.PlaneGeometry(2, 2);

// The material keeps this object, so setting a value here sets the uniform.
const sim_uniforms = {
	res:         { value: new THREE.Vector2() },
	prev_frame:  { value: null as THREE.Texture | null },
	seeds:       { value: null as THREE.Texture | null },
	kernel:      { value: [] as number[] },
	tap_spacing: { value: 0 },
	persistence: { value: 0 },
};
const sim_material = new THREE.ShaderMaterial({ uniforms: sim_uniforms, fragmentShader: sim_shader });
const sim_scene = new THREE.Scene().add(new THREE.Mesh(quad, sim_material));

const screen_material = new THREE.MeshBasicMaterial();
const screen_scene = new THREE.Scene().add(new THREE.Mesh(quad, screen_material));

// Ping-pong buffers; current holds the latest frame. setup() sizes them.
const target_options = {
	minFilter:     THREE.LinearFilter,
	magFilter:     THREE.NearestFilter,
	wrapS:         THREE.RepeatWrapping,
	wrapT:         THREE.RepeatWrapping,
	depthBuffer:   false,
	stencilBuffer: false,
};
let current = new THREE.WebGLRenderTarget(1, 1, target_options);
let next = new THREE.WebGLRenderTarget(1, 1, target_options);

let width = 0;
let height = 0;
let seed_texture: THREE.CanvasTexture | undefined;

/**
 * Draws the seed dots: R, G, B at 1/6, 1/2, 5/6 along the longer axis, solid out to r=2 and
 * fading to transparent by r=10.
 * @param w The canvas's width in pixels.
 * @param h The canvas's height in pixels.
 */
function draw_seeds(ctx: CanvasRenderingContext2D, w: number, h: number) {
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

// (Re)starts the simulation from just the seeds. Sized in CSS pixels, so on HiDPI the
// simulation is upscaled (pixelated, per the CSS).
function setup() {
	width = window.innerWidth;
	height = window.innerHeight;
	renderer.setSize(width, height);

	const seed_canvas = document.createElement("canvas");
	seed_canvas.width = width;
	seed_canvas.height = height;
	draw_seeds(seed_canvas.getContext("2d")!, width, height);
	seed_texture?.dispose();
	seed_texture = new THREE.CanvasTexture(seed_canvas);
	seed_texture.minFilter = THREE.LinearFilter;

	// Freed here (along with anything left from a lost context); reallocated on first use.
	current.dispose();
	next.dispose();
	current.setSize(width, height);
	next.setSize(width, height);
	renderer.setRenderTarget(current);
	renderer.setClearColor(new THREE.Color(GRAY, GRAY, GRAY));
	renderer.clear();

	sim_uniforms.res.value.set(width, height);
	sim_uniforms.seeds.value = seed_texture;
}

/** A standard normal deviate, by Box-Muller. */
function random_normal() {
	const u = 1 - Math.random(); // (0, 1], so the log is finite
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Filters the 5x5 weight grid itself with a 3x3 kernel, zero-padded.
 * @param grid Row-major 5x5 weights.
 * @param kernel_3x3 Row-major 3x3 weights.
 * @returns The filtered row-major 5x5 weights.
 */
function convolve_5x5(grid: number[], kernel_3x3: number[]) {
	const at = (x: number, y: number) => (x < 0 || x >= 5 || y < 0 || y >= 5 ? 0 : grid[y * 5 + x]!);
	return grid.map((_, i) => {
		const x = i % 5;
		const y = Math.floor(i / 5);
		let sum = 0;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				sum += at(x + dx, y + dy) * kernel_3x3[(dy + 1) * 3 + (dx + 1)]!;
			}
		}
		return sum;
	});
}

/**
 * A random kernel: flat 1/25 plus N(0, 0.2) noise per weight (so the noise dominates), smoothed
 * by a random mix of identity and 3x3 blur, then shifted to sum to 1. Smoother weights mean
 * wider stripes and slower growth.
 * @returns Row-major 5x5 weights.
 */
function gen_kernel() {
	const noise = Array.from({ length: 25 }, () => 1 / 25 + 0.2 * random_normal());
	const blur_amount = Math.random();
	const identity = [0, 0, 0, 0, 1, 0, 0, 0, 0];
	const blur = [1, 2, 1, 2, 4, 2, 1, 2, 1].map(b => b / 16);
	const smoothing = blur.map((b, i) => b * blur_amount + identity[i]! * (1 - blur_amount));
	const smoothed = convolve_5x5(noise, smoothing);
	const adjustment = (1 - smoothed.reduce((s, v) => s + v)) / 25;
	const kernel = smoothed.map(k => k + adjustment);
	console.log(JSON.stringify(kernel));
	return kernel;
}

/** Maps [0, 1] onto [0, 1] exponentially: 0 at 0, 1/32 at 1/2, 1 at 1. */
function ease_in_expo(x: number) {
	return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
}

/** Maps [0, 1] onto [0, 1] along half a cosine, so it starts and ends slowly. */
function ease_in_out_sine(x: number) {
	return -(Math.cos(Math.PI * x) - 1) / 2;
}

let old_kernel: number[];
let new_kernel: number[];
let fade_start: number;

/** Starts a crossfade from `from` to a new random kernel. */
function fade_to_new_kernel(from: number[]) {
	old_kernel = from;
	new_kernel = gen_kernel();
	fade_start = performance.now();
}

// Click/tap: jump to a random kernel, fading toward another. The image isn't reset.
function reset_kernel() {
	fade_to_new_kernel(gen_kernel());
}

/** The crossfaded kernel, with mouse X's contrast applied. */
function current_kernel() {
	const t = ease_in_out_sine((performance.now() - fade_start) / KERNEL_FADE_MS);
	// Mouse X: scale each weight's deviation from a flat 1/25 by 0.8x-3.8x. More deviation
	// amplifies more frequencies, more strongly. At the far left, smooth kernels may amplify
	// nothing, and the pattern dissolves. Both the crossfade and this keep the sum at 1.
	const gain = mouse_x * 3 + 0.8;
	return new_kernel.map((k, i) => (k * t + old_kernel[i]! * (1 - t) - 1 / 25) * gain + 1 / 25);
}

/** Runs one simulation step and shows the result. */
function step() {
	// The fade runs on real time, so it advances while paused; the next one starts at the first
	// step after it ends.
	if (performance.now() - fade_start >= KERNEL_FADE_MS) {
		fade_to_new_kernel(new_kernel);
	}
	sim_uniforms.prev_frame.value = current.texture;
	sim_uniforms.kernel.value = current_kernel();
	// Mouse Y, mapped exponentially (0 at top, 1/32 mid-screen, 1 at bottom), sets the tap
	// spacing (pattern scale, up to 1/3 of the height) and how much of the previous frame is kept.
	const y = ease_in_expo(mouse_y);
	sim_uniforms.tap_spacing.value = y * height / 3;
	sim_uniforms.persistence.value = y;

	renderer.setRenderTarget(next);
	renderer.render(sim_scene, camera);
	[current, next] = [next, current];

	screen_material.map = current.texture;
	renderer.setRenderTarget(null);
	renderer.render(screen_scene, camera);
}

let paused = false;
let frame_request = 0;

function loop() {
	frame_request = requestAnimationFrame(loop); // First, so an exception in step() doesn't stop the loop
	step();
}

/** Starts the simulation and wires up the window's input. */
function main() {
	setup();
	reset_kernel();

	// Restarts the simulation from just the seeds. A lost WebGL context loses the buffers (and
	// three.js's clear color), so it restarts too.
	window.addEventListener("resize", setup);
	renderer.domElement.addEventListener("webglcontextrestored", setup);

	let dragging = false;

	window.addEventListener("mousemove", ev => {
		mouse_x = ev.pageX / width;
		mouse_y = ev.pageY / height;
	});
	window.addEventListener("touchmove", ev => {
		const touch = ev.touches[0]!; // The moving touch is still down
		mouse_x = touch.pageX / width;
		mouse_y = touch.pageY / height;
		dragging = true;
	});
	window.addEventListener("touchstart", () => {
		dragging = false;
	});
	window.addEventListener("click", reset_kernel);
	// preventDefault stops the emulated click from resetting again.
	window.addEventListener("touchend", ev => {
		if (!dragging) {
			reset_kernel();
		}
		ev.preventDefault();
	});
	window.addEventListener("keydown", event => {
		if (event.code === "Space") {
			paused = !paused;
			if (paused) {
				cancelAnimationFrame(frame_request);
			} else {
				loop();
			}
		} else if (event.code === "Enter" && paused) {
			step();
		}
	});

	loop();
}

main();
