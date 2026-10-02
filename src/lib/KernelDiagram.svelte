<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// The kernel as a Hinton diagram: each tap's weight as a square, laid out as the taps are on
	// screen, whose area is the weight's size, filled if positive and hollow if negative. Dragging
	// a square up or down changes its weight, and clicking one gives a field to type it in; the
	// taps that change with it are outlined. The middle tap is whatever makes the sum 1, so it
	// follows the others rather than being edited itself.
	import { tick } from "svelte";
	import { type Group, type Kernel, MIDDLE, TAPS, group_of, reweighted, tap_offset } from "./kernel";

	interface Props {
		kernel: Kernel;
		/** Which taps an edit changes together. */
		group: Group;
		/** Called before an edit that undo takes back in one go: a whole drag, or a typed weight. */
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
	/** The most a typed weight can be either way; past 1 or so, it only floods the screen. */
	const MOST = 10;

	/** The tap pointed at, if any. */
	let hover    = $state<number | null>(null);
	/** The tap clicked, if any, which the caption shows a field for. */
	let selected = $state<number | null>(null);
	/** The tap being dragged, if any. */
	let dragged  = $state<number | null>(null);
	/** Text typed into the field and not yet taken, if any, and the tap it's for. */
	let typed    = $state<{ index: number; text: string } | null>(null);
	let field    = $state<HTMLInputElement>();
	/**
	 * The tap pressed while the pointer's down, and where; once it's moved far enough to be a drag,
	 * where that started and the kernel then.
	 */
	let press: { index: number; y: number; from: Kernel | null } | null = null;

	/** The tap the caption describes. */
	const subject = $derived(dragged ?? selected ?? hover);
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

	/** Presses tap `index`, first taking what's typed, as leaving the field would. */
	function down(event: PointerEvent, index: number): void {
		take_typed();
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
			typed      = null;
			selected   = null;
			dragged    = press.index;
			onstart();
		}
		const delta = (press.y - event.clientY) * PER_PX;
		onedit(reweighted(press.from, group_of(press.index, group), (k) => k + delta), true);
	}

	/** Ends a press; one that didn't drag was a click, which selects its tap or, if it was already, unselects it. */
	function up(event: PointerEvent): void {
		if (press !== null && press.from === null) {
			typed    = null;
			selected = selected === press.index ? null : press.index;
			// On a touchscreen, focus would put up a keyboard over the screen.
			if (event.pointerType === "mouse") {
				void tick().then(() => field?.select());
			}
		}
		press   = null;
		dragged = null;
	}

	function cancel(): void {
		press   = null;
		dragged = null;
	}

	/**
	 * Gives the tap typed for, and its group, the weight typed, up to MOST either way. The field
	 * goes back to the tap's weight, so a typo that isn't a number is dropped.
	 */
	function take_typed(): void {
		if (typed === null) {
			return;
		}
		const weight = Number.parseFloat(typed.text);
		const taps   = group_of(typed.index, group);
		typed = null;
		if (Number.isFinite(weight)) {
			onstart();
			onedit(reweighted(kernel, taps, () => Math.max(-MOST, Math.min(MOST, weight))), false);
		}
	}

	function on_field_key(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			typed    = null;
			selected = null;
		}
	}
</script>

<figure>
	<div class="figure-title">Hinton diagram</div>
	<svg viewBox="-1 -1 {5 * CELL + 2} {5 * CELL + 2}" width={5 * CELL + 2} height={5 * CELL + 2} role="img" aria-label="The kernel's 25 weights"
		onpointermove={move} onpointerup={up} onpointercancel={cancel} onpointerleave={() => (hover = null)}>
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
				Drag or click to edit.
			{:else if subject === selected && subject !== MIDDLE}
				{offset(subject)}
				<input bind:this={field} type="number" step="0.01" min={-MOST} max={MOST} value={typed?.text ?? kernel[subject]!.toFixed(3)}
					oninput={(e) => (typed = { index: subject, text: e.currentTarget.value })} onchange={take_typed} onkeydown={on_field_key} aria-label="Weight of tap {offset(subject)}" />
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
	/* Tall enough for the field, so the lines don't move as it comes and goes. */
	.line {
		display: flex;
		align-items: center;
		height: 17px;
		white-space: nowrap;
		overflow: hidden;
	}
	.accent {
		color: var(--accent);
	}
	input {
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
		height: 16px;
		margin-left: 4px;
		padding: 0 2px;
		background: var(--card);
		border: 1px solid var(--rule-strong);
		font-variant-numeric: tabular-nums;
	}
</style>
