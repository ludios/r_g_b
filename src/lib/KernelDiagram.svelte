<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// The kernel as a Hinton diagram: each tap's weight as a square, laid out as the taps are on
	// screen, whose area is the weight's size, filled if positive and hollow if negative. Dragging
	// a square up or down changes its weight; the taps that change with it are outlined. The middle
	// tap is whatever makes the sum 1, so it follows the others rather than being dragged itself.
	import { type Group, type Kernel, MIDDLE, TAPS, group_of, reweighted, tap_offset } from "./kernel";

	interface Props {
		kernel: Kernel;
		/** Which taps an edit changes together. */
		group: Group;
		/** Called before a drag, which undo takes back in one go. */
		onstart: () => void;
		/**
		 * Called with each edited kernel.
		 * @param dragging Whether it's one move of a drag, with more to come.
		 */
		onedit: (kernel: Kernel, dragging: boolean) => void;
	}

	let { kernel, group, onstart, onedit }: Props = $props();

	const CELL = 26;
	/** How much a weight changes per pixel of drag. */
	const PER_PX = 0.005;
	/** How many pixels a press moves up or down before it's a drag rather than a click. */
	const SLOP = 3;

	/** The tap pointed at, if any. */
	let hover    = $state<number | null>(null);
	/** The tap being dragged, if any. */
	let dragged  = $state<number | null>(null);
	/**
	 * The tap pressed while the pointer's down, and where; once it's moved far enough to be a drag,
	 * where that started and the kernel then.
	 */
	let press: { index: number; y: number; from: Kernel | null } | null = null;

	/** The tap the caption describes. */
	const subject = $derived(dragged ?? hover);
	/** The taps that change with the subject. */
	const linked  = $derived(subject === null || subject === MIDDLE ? [] : group_of(subject, group));

	/** The top left of tap `i`'s cell: row 0 of a kernel is the bottom row. */
	function cell(i: number): { x: number; y: number } {
		return { x: (tap_offset(i).x + 2) * CELL, y: (2 - tap_offset(i).y) * CELL };
	}

	/** A weight of 1 or more fills its cell, less fills less, by area. */
	function side(weight: number): number {
		return CELL * 0.9 * Math.sqrt(Math.min(1, Math.abs(weight)));
	}

	/** Where tap `i` reads from, in taps from the pixel itself; up is +y. */
	function offset(i: number): string {
		return `(${tap_offset(i).x}, ${tap_offset(i).y})`;
	}

	function down(event: PointerEvent, index: number): void {
		event.preventDefault();
		(event.currentTarget as Element).closest("svg")!.setPointerCapture(event.pointerId);
		press = { index, y: event.clientY, from: null };
	}

	/** Once a press has moved far enough up or down, drags the tap's weight, and its group's, with it. */
	function move(event: PointerEvent): void {
		if (press === null || press.index === MIDDLE) {
			return;
		}
		if (press.from === null) {
			if (Math.abs(event.clientY - press.y) < SLOP) {
				return;
			}
			press.y    = event.clientY;
			press.from = kernel;
			dragged    = press.index;
			onstart();
		}
		const delta = (press.y - event.clientY) * PER_PX;
		onedit(reweighted(press.from, group_of(press.index, group), (k) => k + delta), true);
	}

	function end(): void {
		press   = null;
		dragged = null;
	}
</script>

<figure>
	<div class="figure-title">Hinton diagram</div>
	<svg viewBox="-1 -1 {5 * CELL + 2} {5 * CELL + 2}" width={5 * CELL + 2} height={5 * CELL + 2} role="img" aria-label="The kernel's 25 weights"
		onpointermove={move} onpointerup={end} onpointercancel={end} onpointerleave={() => (hover = null)}>
		{#each { length: TAPS } as _, i (i)}
			{@const { x, y } = cell(i)}
			{@const w = kernel[i]!}
			{@const s = side(w)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g class="tap" class:middle={i === MIDDLE} class:linked={linked.includes(i)} onpointerdown={(e) => down(e, i)} onpointerenter={() => (hover = i)}>
				<rect class="cell" x={x} y={y} width={CELL} height={CELL} />
				<rect class="weight" class:negative={w < 0} x={x + (CELL - s) / 2} y={y + (CELL - s) / 2} width={s} height={s} />
			</g>
		{/each}
	</svg>
	<figcaption>
		<div class="line">
			{#if subject === null}
				Drag to edit.
			{:else}
				{offset(subject)}: {kernel[subject]!.toFixed(3)}
			{/if}
		</div>
		<div class="line"><span class="accent">Middle</span>: 1 − the rest.</div>
	</figcaption>
</figure>

<style>
	/* As wide as the diagram, whatever the caption says, so nothing beside it moves and the title
	   centers over it. */
	figure {
		margin: 0;
		width: 132px;
	}
	svg {
		display: block;
		touch-action: none;
		cursor: ns-resize;
	}
	.middle {
		cursor: default;
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
	figcaption {
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.line {
		white-space: nowrap;
		overflow: hidden;
	}
	.accent {
		color: var(--accent);
	}
</style>
