<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// Mouse X: kernel contrast. Mouse Y: tap spacing; near the bottom it also keeps more of the
	// previous frame, freezing at the very bottom. Click/tap: new kernel (one is also crossfaded in
	// every minute). Space: pause. Enter (while paused): single step.
	import { onMount } from "svelte";
	import { KernelDrift, with_contrast } from "$lib/kernel";
	import { Simulation } from "$lib/simulation";

	let canvas: HTMLCanvasElement;

	/** Maps [0, 1] onto [0, 1] exponentially: 0 at 0, 1/32 at 1/2, 1 at 1. */
	function ease_in_expo(x: number): number {
		return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
	}

	onMount(() => {
		const sim = new Simulation(canvas);
		const drift = new KernelDrift(Math.random);
		/** The pointer's position as a fraction of the window, 0 at the top left. */
		let mouse_x = 0.5;
		let mouse_y = 0.5;
		let paused = false;
		let frame_request = 0;

		function restart(): void {
			sim.restart(window.innerWidth, window.innerHeight);
		}

		function step(): void {
			const now = performance.now();
			drift.advance(now);
			// Mouse Y, mapped exponentially (0 at top, 1/32 mid-screen, 1 at bottom), sets the tap
			// spacing (pattern scale, up to 1/3 of the height) and how much of the previous frame
			// is kept. Mouse X scales each weight's deviation from flat by 0.8x-3.8x.
			const y = ease_in_expo(mouse_y);
			sim.step({
				kernel:      with_contrast(drift.kernel(now), mouse_x * 3 + 0.8),
				tap_spacing: y * window.innerHeight / 3,
				persistence: y,
			});
		}

		function loop(): void {
			frame_request = requestAnimationFrame(loop); // First, so an exception in step() doesn't stop the loop
			step();
		}

		function new_kernel(): void {
			drift.jump(performance.now());
		}

		restart();
		new_kernel();

		// Restarts the simulation from just the seeds. A lost WebGL context loses the buffers (and
		// three.js's clear color), so it restarts too.
		window.addEventListener("resize", restart);
		canvas.addEventListener("webglcontextrestored", restart);

		let dragging = false;

		window.addEventListener("mousemove", ev => {
			mouse_x = ev.pageX / window.innerWidth;
			mouse_y = ev.pageY / window.innerHeight;
		});
		window.addEventListener("touchmove", ev => {
			const touch = ev.touches[0]!; // The moving touch is still down
			mouse_x = touch.pageX / window.innerWidth;
			mouse_y = touch.pageY / window.innerHeight;
			dragging = true;
		});
		window.addEventListener("touchstart", () => {
			dragging = false;
		});
		window.addEventListener("click", new_kernel);
		// preventDefault stops the emulated click from resetting again.
		window.addEventListener("touchend", ev => {
			if (!dragging) {
				new_kernel();
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
	});
</script>

<svelte:head>
	<title>r_g_b.html by v21</title>
</svelte:head>

<canvas bind:this={canvas}></canvas>

<style>
	/* The simulation is sized in CSS pixels, so on HiDPI it's upscaled, pixelated. */
	canvas {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
	}
</style>
