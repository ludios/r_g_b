<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// Which stripes a step grows: every point is a wave of stripes, flat in the middle, finer
	// farther out, and across the direction it lies in. Growing waves are shaded in the accent, more
	// for faster; a hairline rings them; hatching marks those that invert each step. With jitter,
	// the copies of the middle square, which the taps can't tell from it, fade.
	import { onMount } from "svelte";
	import { type GrowthMap, type Mode, type StepModel, fastest, growth_map, inverts, mode_at, motion } from "./spectrum";

	interface Props {
		model: StepModel;
		/** Anything that changes the page's colors, so the map is drawn again. */
		theme: string;
		/** Called with a wave's cycles per pixel, across and up, when it's clicked. */
		onplant: (fx: number, fy: number) => void;
		/** The same, when it's shift-clicked. */
		ongrow: (fx: number, fy: number) => void;
		/** Set to the fastest stripes in words, or those under the pointer; for the page to show. */
		caption?: string;
	}

	let { model, theme, onplant, ongrow, caption = $bindable("") }: Props = $props();

	const SIZE = 175;
	/** Redrawn at most this often, since a morphing kernel changes every frame. */
	const EVERY_MS = 100;

	let canvas: HTMLCanvasElement;
	// Raw: a deep proxy over its arrays would make every read slow.
	let map     = $state.raw<GrowthMap | null>(null);
	/** The point under the pointer, if any, read from the map as it's redrawn. */
	let pointed = $state<number | null>(null);
	const hovered = $derived(map === null || pointed === null ? null : mode_at(map, pointed));
	/** The map's fastest stripes, found as it's made. */
	let peak    = $state.raw<Mode | null>(null);
	let last    = 0;
	/** Counts the browser's light/dark switches, which the map's colors follow when the theme does. */
	let schemes = $state(0);

	function scheme_changed(): void {
		schemes++;
	}

	onMount(() => {
		const query = matchMedia("(prefers-color-scheme: dark)");
		query.addEventListener("change", scheme_changed);
		return () => query.removeEventListener("change", scheme_changed);
	});

	$effect(() => {
		const current = model;
		void theme;
		void schemes;
		const wait  = Math.max(0, last + EVERY_MS - performance.now());
		const timer = setTimeout(() => {
			last = performance.now();
			const made = growth_map(current, SIZE);
			const best = fastest(made);
			map  = made;
			peak = best;
			draw(made, best, current.spacing);
		}, wait);
		return () => clearTimeout(timer);
	});

	/** The red, green and blue of a computed CSS color such as "rgb(100, 77, 46)". */
	function rgb(color: string): number[] {
		return (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
	}

	interface Palette {
		card: number[];
		accent: number[];
		text: number[];
		rule: string;
	}

	/** The palette, and what it was read for: the theme setting and the browser's preference. */
	let cached: { key: string; palette: Palette } | null = null;

	/** The page's palette, resolved: the canvas's CSS borrows properties to carry it. */
	function palette(): Palette {
		const key = `${theme} ${matchMedia("(prefers-color-scheme: dark)").matches}`;
		if (cached?.key !== key) {
			const style = getComputedStyle(canvas);
			cached = { key, palette: { card: rgb(style.backgroundColor), accent: rgb(style.color), text: rgb(style.caretColor), rule: style.outlineColor } };
		}
		return cached.palette;
	}

	/**
	 * Draws the map, ringing the fastest stripes and outlining the middle square.
	 * @param spacing The tap spacing the map was made for.
	 */
	function draw(m: GrowthMap, best: Mode | null, spacing: number): void {
		const { card, accent, text, rule } = palette();
		const ctx   = canvas.getContext("2d")!;
		const image = ctx.createImageData(SIZE, SIZE);
		const grows = (i: number) => m.growth[i]! > 1;
		for (let row = 0; row < SIZE; row++) {
			for (let column = 0; column < SIZE; column++) {
				const i    = row * SIZE + column;
				const growth = m.growth[i]!;
				let color  = card;
				const edge = (column + 1 < SIZE && grows(i + 1) !== grows(i)) || (row + 1 < SIZE && grows(i + SIZE) !== grows(i));
				if (edge) {
					color = text;
				} else if (growth > 1) {
					// Any growth shows; ×4 a step or more is the full accent.
					const t = 0.25 + 0.75 * Math.min(1, Math.log(growth) / Math.log(4));
					const hatched = inverts(m.phase[i]!) && (row + column) % 4 === 0;
					color = mix(card, accent, hatched ? t * 0.35 : t);
				}
				image.data[i * 4]     = color[0]!;
				image.data[i * 4 + 1] = color[1]!;
				image.data[i * 4 + 2] = color[2]!;
				image.data[i * 4 + 3] = 255;
			}
		}
		ctx.putImageData(image, 0, 0);

		const half = (SIZE - 1) / 2;
		const px   = (f: number) => (f / m.reach) * half;
		ctx.strokeStyle = rule;
		ctx.lineWidth = 1;
		// The middle square: the copies beyond it are the same stripes to the taps.
		const square = px(0.5 / spacing);
		if (square < half) {
			ctx.strokeRect(half - square + 0.5, half - square + 0.5, 2 * square, 2 * square);
		}
		ctx.beginPath();
		ctx.moveTo(half + 0.5, half - 3);
		ctx.lineTo(half + 0.5, half + 4);
		ctx.moveTo(half - 3, half + 0.5);
		ctx.lineTo(half + 4, half + 0.5);
		ctx.stroke();
		if (best !== null) {
			ctx.strokeStyle = `rgb(${text.join(",")})`;
			for (const sign of [1, -1]) {
				ctx.beginPath();
				ctx.arc(half + 0.5 + sign * px(best.fx), half + 0.5 - sign * px(best.fy), 4, 0, 2 * Math.PI);
				ctx.stroke();
			}
		}
	}

	function mix(a: number[], b: number[], t: number): number[] {
		return a.map((v, i) => Math.round(v + (b[i]! - v) * t));
	}

	/** The index of the point under the pointer: offsetX and offsetY are inside the border. */
	function at(event: MouseEvent): number {
		const column = Math.floor((event.offsetX / canvas.clientWidth) * SIZE);
		const row    = Math.floor((event.offsetY / canvas.clientHeight) * SIZE);
		return Math.min(SIZE - 1, Math.max(0, row)) * SIZE + Math.min(SIZE - 1, Math.max(0, column));
	}

	/** A mode in words: its stripes' spacing, growth and motion. */
	function words(mode: Mode): string {
		if (Math.hypot(mode.fx, mode.fy) < 1e-9) {
			return "Flat: stays flat.";
		}
		const { period, speed } = motion(mode);
		const moving = speed === null ? "inverting every step" : speed < 0.05 ? "standing still" : `moving ${speed.toFixed(1)} px a step`;
		return `stripes ${period.toFixed(1)} px apart, ×${mode.growth.toFixed(2)} a step, ${moving}.`;
	}

	$effect(() => {
		caption = hovered !== null ? `Here: ${words(hovered)} Click: start from them. Shift-click: a kernel that grows them.`
			: peak !== null ? `Fastest: ${words(peak)}`
			: map !== null ? "Nothing grows: every pattern fades."
			: "";
	});

	function plant(event: MouseEvent): void {
		if (map === null) {
			return;
		}
		const mode = mode_at(map, at(event));
		if (Math.hypot(mode.fx, mode.fy) > 0) {
			(event.shiftKey ? ongrow : onplant)(mode.fx, mode.fy);
		}
	}
</script>

<figure>
	<div class="title">Frequency response</div>
	<canvas bind:this={canvas} width={SIZE} height={SIZE} aria-label="Frequency response: which stripes grow"
		onpointermove={(e) => (pointed = at(e))} onpointerleave={() => (pointed = null)} onclick={plant}></canvas>
	<figcaption>Middle: flat; edge: fine stripes.<br />Shaded: grows; hatched: inverts.</figcaption>
</figure>

<style>
	figure {
		margin: 0;
	}
	.title {
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
		margin-bottom: 2px;
	}
	figcaption {
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-muted);
		white-space: nowrap;
	}
	/* One point a pixel, inside the 1 px border. color, background-color, caret-color and
	   outline-color carry the palette to draw(). */
	canvas {
		display: block;
		box-sizing: content-box;
		width: 175px;
		height: 175px;
		color: var(--accent);
		background-color: var(--card);
		caret-color: var(--text);
		outline: 0 none var(--rule-strong);
		border: 1px solid var(--rule);
		cursor: crosshair;
		touch-action: none;
	}
</style>
