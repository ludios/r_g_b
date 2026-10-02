<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// Where one pixel's taps land on screen, each marked like the kernel diagram's squares: filled
	// if its weight is positive, hollow if negative, by area. Taps past an edge wrap around, as the
	// step's do. Jitter, different at every pixel, isn't shown.
	import { type Kernel, MIDDLE, TAPS, tap_offset, tap_pixels } from "./kernel";

	interface Props {
		kernel: Kernel;
		/** The distance between taps, in pixels of the simulation. */
		spacing: number;
		/** Screen pixels per pixel of the simulation. */
		pixel: number;
		/** The screen pixel the taps are for, from the top left. */
		at: { x: number; y: number };
		/** The canvas's size on screen, where the taps wrap. */
		width: number;
		height: number;
	}

	let { kernel, spacing, pixel, at, width, height }: Props = $props();

	/** A weight of 1 or more gets this side, less gets less, by area. */
	const BIGGEST = 24;

	/** `n` modulo `m`, in [0, m). */
	function wrap(n: number, m: number): number {
		return ((n % m) + m) % m;
	}

	const marks = $derived(Array.from({ length: TAPS }, (_, i) => {
		// Rounded to whole pixels as the step rounds them; up on screen is +y in the kernel.
		const ox = tap_pixels(spacing, tap_offset(i).x) * pixel;
		const oy = tap_pixels(spacing, tap_offset(i).y) * pixel;
		const w  = kernel[i]!;
		return {
			x:        wrap(at.x + ox, width),
			y:        wrap(at.y - oy, height),
			side:     Math.max(4, BIGGEST * Math.sqrt(Math.min(1, Math.abs(w)))),
			negative: w < 0,
			middle:   i === MIDDLE,
		};
	}));
</script>

<svg class="taps" aria-hidden="true">
	{#each marks as mark, i (i)}
		<rect class:negative={mark.negative} x={mark.x - mark.side / 2} y={mark.y - mark.side / 2} width={mark.side} height={mark.side} />
		{#if mark.middle}
			<circle cx={mark.x} cy={mark.y} r={BIGGEST * 0.7} />
		{/if}
	{/each}
</svg>

<style>
	/* Over the image and under the controls; white with a black edge shows on any colors. */
	.taps {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	rect {
		fill: #fff;
		stroke: #000;
		stroke-width: 1.5;
	}
	rect.negative {
		fill: none;
		stroke: #fff;
		stroke-width: 2;
		paint-order: stroke;
		filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);
	}
	circle {
		fill: none;
		stroke: #fff;
		stroke-width: 1.5;
		filter: drop-shadow(0 0 1px #000);
	}
</style>
