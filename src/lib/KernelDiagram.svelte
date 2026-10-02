<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// The kernel as a Hinton diagram: each tap's weight as a square, laid out as the taps are on
	// screen, whose area is the weight's size, filled if positive and hollow if negative. Dragging
	// a square up or down changes its weight; the taps that move with it are outlined.
	import { type Group, type Kernel, TAPS, group_of, tap_offset } from "./kernel";

	interface Props {
		kernel: Kernel;
		/** Which taps a drag moves together. */
		group: Group;
		/** Called as a drag begins. */
		onstart: () => void;
		/** Called with a tap's index and its new weight as it's dragged. */
		onedit: (index: number, weight: number) => void;
	}

	let { kernel, group, onstart, onedit }: Props = $props();

	const CELL = 26;
	/** How much a weight changes per pixel of drag. */
	const PER_PX = 0.005;

	/** The tap being dragged or pointed at, if any, and those that move with it. */
	let active  = $state<number | null>(null);
	const linked = $derived(active === null ? [] : group_of(active, group));
	let drag: { index: number; y: number; weight: number } | null = null;

	/** The top left of tap `i`'s cell: row 0 of a kernel is the bottom row. */
	function cell(i: number): { x: number; y: number } {
		return { x: (i % 5) * CELL, y: (4 - Math.floor(i / 5)) * CELL };
	}

	/** A weight of 1 or more fills its cell, less fills less, by area. */
	function side(weight: number): number {
		return CELL * 0.9 * Math.sqrt(Math.min(1, Math.abs(weight)));
	}

	function start(event: PointerEvent, index: number): void {
		event.preventDefault();
		(event.currentTarget as Element).closest("svg")!.setPointerCapture(event.pointerId);
		drag = { index, y: event.clientY, weight: kernel[index]! };
		active = index;
		onstart();
	}

	function move(event: PointerEvent): void {
		if (drag !== null) {
			onedit(drag.index, drag.weight + (drag.y - event.clientY) * PER_PX);
		}
	}

	function end(): void {
		drag = null;
	}

	/** Where tap `i` reads from, in taps from the pixel itself; up is +y. */
	function offset(i: number): string {
		return `(${tap_offset(i).x}, ${tap_offset(i).y})`;
	}
</script>

<figure>
	<div class="title">Hinton diagram</div>
	<svg viewBox="-1 -1 {5 * CELL + 2} {5 * CELL + 2}" width={5 * CELL + 2} height={5 * CELL + 2} role="img" aria-label="The kernel's 25 weights"
		onpointermove={move} onpointerup={end} onpointercancel={end} onpointerleave={() => drag === null && (active = null)}>
		{#each { length: TAPS } as _, i (i)}
			{@const { x, y } = cell(i)}
			{@const w = kernel[i]!}
			{@const s = side(w)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g class="tap" class:middle={i === 12} class:linked={linked.includes(i)} onpointerdown={(e) => start(e, i)} onpointerenter={() => drag === null && (active = i)}>
				<rect class="cell" x={x} y={y} width={CELL} height={CELL} />
				<rect class="weight" class:negative={w < 0} x={x + (CELL - s) / 2} y={y + (CELL - s) / 2} width={s} height={s} />
			</g>
		{/each}
	</svg>
	<figcaption>
		{#if active === null}
			Drag to edit.
		{:else}
			{offset(active)}: {kernel[active]!.toFixed(3)}
		{/if}
	</figcaption>
</figure>

<style>
	/* As wide as the diagram, whatever the caption says, so nothing beside it moves. */
	figure {
		margin: 0;
		width: 132px;
	}
	svg {
		display: block;
		touch-action: none;
		cursor: ns-resize;
	}
	.cell {
		fill: transparent;
		stroke: var(--rule);
		stroke-width: 1;
	}
	.middle .cell {
		stroke: var(--accent);
	}
	.linked .cell {
		stroke: var(--text);
	}
	.weight {
		fill: var(--text);
	}
	.weight.negative {
		fill: none;
		stroke: var(--text);
		stroke-width: 1.5;
	}
	.title {
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
		margin-bottom: 2px;
	}
	figcaption {
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
	}
</style>
