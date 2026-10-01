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
import simShader from "./sim.frag?raw";

const KERNEL_FADE_MS = 60 * 1000;
const GRAY = 0.05; // Fresh buffers' color; see the top comment for why not black

let mouseX = 0.5;
let mouseY = 0.5;

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
const simUniforms = {
	res: { value: new THREE.Vector2() },
	prevFrame: { value: null as THREE.Texture | null },
	seeds: { value: null as THREE.Texture | null },
	kernel: { value: [] as number[] },
	tapSpacing: { value: 0 },
	persistence: { value: 0 },
};
const simMaterial = new THREE.ShaderMaterial({ uniforms: simUniforms, fragmentShader: simShader });
const simScene = new THREE.Scene().add(new THREE.Mesh(quad, simMaterial));

const screenMaterial = new THREE.MeshBasicMaterial();
const screenScene = new THREE.Scene().add(new THREE.Mesh(quad, screenMaterial));

// Ping-pong buffers; current holds the latest frame. setup() sizes them.
const targetOptions = {
	minFilter: THREE.LinearFilter,
	magFilter: THREE.NearestFilter,
	wrapS: THREE.RepeatWrapping,
	wrapT: THREE.RepeatWrapping,
	depthBuffer: false,
	stencilBuffer: false,
};
let current = new THREE.WebGLRenderTarget(1, 1, targetOptions);
let next = new THREE.WebGLRenderTarget(1, 1, targetOptions);

let width = 0;
let height = 0;
let seedTexture: THREE.CanvasTexture | undefined;

// (Re)starts the simulation from just the seeds. Sized in CSS pixels, so on HiDPI the
// simulation is upscaled (pixelated, per the CSS).
function setup() {
	width = window.innerWidth;
	height = window.innerHeight;
	renderer.setSize(width, height);

	const seedCanvas = document.createElement("canvas");
	seedCanvas.width = width;
	seedCanvas.height = height;
	drawSeeds(seedCanvas.getContext("2d")!, width, height);
	seedTexture?.dispose();
	seedTexture = new THREE.CanvasTexture(seedCanvas);
	seedTexture.minFilter = THREE.LinearFilter;

	current.setSize(width, height); // Reallocates if the size changed
	next.setSize(width, height);
	renderer.setRenderTarget(current);
	renderer.setClearColor(new THREE.Color(GRAY, GRAY, GRAY));
	renderer.clear();

	simUniforms.res.value.set(width, height);
	simUniforms.seeds.value = seedTexture;
}

// Seed dots: R, G, B at 1/6, 1/2, 5/6 along the longer axis, solid out to r=2 and fading to
// transparent by r=10.
function drawSeeds(ctx: CanvasRenderingContext2D, w: number, h: number) {
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

function step() {
	// The fade runs on real time, so it advances while paused; the next one starts at the first
	// step after it ends.
	if (performance.now() - fadeStart >= KERNEL_FADE_MS) {
		fadeToNewKernel(newKernel);
	}
	simUniforms.prevFrame.value = current.texture;
	simUniforms.kernel.value = currentKernel();
	// Mouse Y, mapped exponentially (0 at top, 1/32 mid-screen, 1 at bottom), sets the tap
	// spacing (pattern scale, up to 1/3 of the height) and how much of the previous frame is kept.
	const y = easeInExpo(mouseY);
	simUniforms.tapSpacing.value = y * height / 3;
	simUniforms.persistence.value = y;

	renderer.setRenderTarget(next);
	renderer.render(simScene, camera);
	[current, next] = [next, current];

	screenMaterial.map = current.texture;
	renderer.setRenderTarget(null);
	renderer.render(screenScene, camera);
}

function easeInExpo(x: number) {
	return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
}

function easeInOutSine(x: number) {
	return -(Math.cos(Math.PI * x) - 1) / 2;
}

let oldKernel: number[];
let newKernel: number[];
let fadeStart: number;

function fadeToNewKernel(from: number[]) {
	oldKernel = from;
	newKernel = genKernel();
	fadeStart = performance.now();
}

// Click/tap: jump to a random kernel, fading toward another. The image isn't reset.
function resetKernel() {
	fadeToNewKernel(genKernel());
}

function currentKernel() {
	const t = easeInOutSine((performance.now() - fadeStart) / KERNEL_FADE_MS);
	// Mouse X: scale each weight's deviation from a flat 1/25 by 0.8x-3.8x. More deviation
	// amplifies more frequencies, more strongly. At the far left, smooth kernels may amplify
	// nothing, and the pattern dissolves. Both the crossfade and this keep the sum at 1.
	const gain = mouseX * 3 + 0.8;
	return newKernel.map((k, i) => (k * t + oldKernel[i]! * (1 - t) - 1 / 25) * gain + 1 / 25);
}

// Flat 1/25 plus N(0, 0.2) noise per weight (so the noise dominates), smoothed by a random
// mix of identity and 3x3 blur, then shifted to sum to 1. Smoother weights mean wider
// stripes and slower growth.
function genKernel() {
	const noise = Array.from({ length: 25 }, () => 1 / 25 + 0.2 * randomNormal());
	const blurAmount = Math.random();
	const identity = [0, 0, 0, 0, 1, 0, 0, 0, 0];
	const blur = [1, 2, 1, 2, 4, 2, 1, 2, 1].map(b => b / 16);
	const smoothing = blur.map((b, i) => b * blurAmount + identity[i]! * (1 - blurAmount));
	const smoothed = convolve5x5(noise, smoothing);
	const adjustment = (1 - smoothed.reduce((s, v) => s + v)) / 25;
	const kernel = smoothed.map(k => k + adjustment);
	console.log(JSON.stringify(kernel));
	return kernel;
}

// Box-Muller
function randomNormal() {
	const u = 1 - Math.random(); // (0, 1], so the log is finite
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Filters the 5x5 weight grid itself with a 3x3 kernel, zero-padded.
function convolve5x5(grid: number[], kernel3x3: number[]) {
	const at = (x: number, y: number) => (x < 0 || x >= 5 || y < 0 || y >= 5 ? 0 : grid[y * 5 + x]!);
	return grid.map((_, i) => {
		const x = i % 5;
		const y = Math.floor(i / 5);
		let sum = 0;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				sum += at(x + dx, y + dy) * kernel3x3[(dy + 1) * 3 + (dx + 1)]!;
			}
		}
		return sum;
	});
}

let paused = false;
let frameRequest = 0;

function loop() {
	frameRequest = requestAnimationFrame(loop); // First, so an exception in step() doesn't stop the loop
	step();
}

setup();
resetKernel();

// Restarts the simulation from just the seeds. A lost WebGL context loses the buffers (and
// three.js's clear color), so it restarts too.
window.addEventListener("resize", setup);
renderer.domElement.addEventListener("webglcontextrestored", setup);

let dragging = false;

window.addEventListener("mousemove", ev => {
	mouseX = ev.pageX / width;
	mouseY = ev.pageY / height;
});
window.addEventListener("touchmove", ev => {
	const touch = ev.touches[0]!; // The moving touch is still down
	mouseX = touch.pageX / width;
	mouseY = touch.pageY / height;
	dragging = true;
});
window.addEventListener("touchstart", () => { dragging = false; });
window.addEventListener("click", resetKernel);
// preventDefault stops the emulated click from resetting again.
window.addEventListener("touchend", ev => {
	if (!dragging) resetKernel();
	ev.preventDefault();
});
window.addEventListener("keydown", event => {
	if (event.code === "Space") {
		paused = !paused;
		if (paused) {
			cancelAnimationFrame(frameRequest);
		} else {
			loop();
		}
	} else if (event.code === "Enter" && paused) {
		step();
	}
});

loop();
