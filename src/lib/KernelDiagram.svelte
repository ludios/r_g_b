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
	/** How many pixels a press moves up or down before it's a drag rather than a click: a finger wobbles more than a mouse. */
	const SLOP = { mouse: 3, other: 10 };
	/** The most a typed weight can be either way; past 1 or so, it only floods the screen. */
	const MOST = 10;

	/** The tap pointed at, if any. */
	let hover    = $state<number | null>(null);
	/** The tap clicked, if any, which the caption shows a field for; never the middle, which follows the others. */
	let selected = $state<number | null>(null);
	/** The tap being dragged, if any. */
	let dragged  = $state<number | null>(null);
	/**
	 * The field's text while it has focus, held still so a morphing kernel doesn't rewrite what's
	 * about to be typed over, and whether it's been typed in since.
	 */
	let draft    = $state<{ text: string; typed: boolean } | null>(null);
	let field    = $state<HTMLInputElement>();
	/**
	 * The tap pressed, by which pointer, and where; once it's moved far enough to be a drag, where
	 * that started and the kernel then.
	 */
	let press: { pointer: number; index: number; y: number; from: Kernel | null } | null = null;

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

	/** A weight to three places, where one too small to show is 0, not -0. */
	function format(weight: number): string {
		return (Math.abs(weight) < 0.0005 ? 0 : weight).toFixed(3);
	}

	/**
	 * Presses tap `index` with the primary button, unless another pointer already is, first taking
	 * what's typed, as leaving the field would.
	 */
	function down(event: PointerEvent, index: number): void {
		if (event.button !== 0 || press !== null) {
			return;
		}
		take_draft();
		event.preventDefault();
		(event.currentTarget as Element).closest("svg")!.setPointerCapture(event.pointerId);
		press = { pointer: event.pointerId, index, y: event.clientY, from: null };
	}

	/** Once a press has moved far enough up or down, drags the tap's weight, and its group's, with it. */
	function move(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointer || press.index === MIDDLE) {
			return;
		}
		if (press.from === null) {
			if (Math.abs(event.clientY - press.y) < (event.pointerType === "mouse" ? SLOP.mouse : SLOP.other)) {
				return;
			}
			press.y    = event.clientY;
			press.from = kernel;
			selected   = null;
			dragged    = press.index;
			onstart();
		}
		const delta = (press.y - event.clientY) * PER_PX;
		onedit(reweighted(press.from, group_of(press.index, group), (k) => k + delta), true);
	}

	/**
	 * Ends the pointer's press, on pointerup, or if it's cancelled or the diagram loses it. One that
	 * didn't drag and ended in pointerup was a click, which selects its tap or, if it already was or
	 * it's the middle, unselects it.
	 */
	function release(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointer) {
			return;
		}
		if (event.type === "pointerup" && press.from === null) {
			draft    = null;
			selected = selected === press.index || press.index === MIDDLE ? null : press.index;
			// On a touchscreen, focus would put up a keyboard over the screen.
			if (event.pointerType === "mouse" && selected !== null) {
				hold();
				void tick().then(() => field?.select());
			}
		}
		press   = null;
		dragged = null;
	}

	/** Holds the field's text still, at the selected tap's weight. */
	function hold(): void {
		draft = selected === null ? null : { text: format(kernel[selected]!), typed: false };
	}

	/**
	 * Gives the selected tap, and its group, the weight typed into the field, up to MOST either way,
	 * if it's a number and changes any of them.
	 */
	function take_draft(): void {
		if (draft === null || !draft.typed || selected === null) {
			return;
		}
		const weight = Number.parseFloat(draft.text);
		draft = null;
		if (!Number.isFinite(weight)) {
			return;
		}
		const value = Math.max(-MOST, Math.min(MOST, weight));
		const taps  = group_of(selected, group);
		if (taps.some((i) => kernel[i] !== value)) {
			onstart();
			onedit(reweighted(kernel, taps, () => value), false);
		}
	}

	/** Leaving the field takes what's typed, and lets it follow the kernel again. */
	function leave(): void {
		take_draft();
		draft = null;
	}

	/** Enter takes what's typed, and Escape drops it and closes the field. */
	function on_field_key(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			take_draft();
			hold();
		} else if (event.key === "Escape") {
			draft    = null;
			selected = null;
		}
	}
</script>

<figure>
	<div class="figure-title">Hinton diagram</div>
	<svg viewBox="-1 -1 {5 * CELL + 2} {5 * CELL + 2}" width={5 * CELL + 2} height={5 * CELL + 2} role="img" aria-label="The kernel's 25 weights"
		onpointermove={move} onpointerup={release} onpointercancel={release} onlostpointercapture={release} onpointerleave={() => (hover = null)}>
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
			{:else if subject === selected}
				{offset(subject)}
				<input bind:this={field} type="number" step="0.001" min={-MOST} max={MOST} value={draft?.text ?? format(kernel[subject]!)}
					onfocus={hold} oninput={(e) => (draft = { text: e.currentTarget.value, typed: true })} onblur={leave} onkeydown={on_field_key}
					aria-label="Weight of tap {offset(subject)}" />
			{:else}
				{offset(subject)}: {format(kernel[subject]!)}
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
	/* Tall enough for the field, so the lines don't move as it comes and goes. Not clipped, so
	   neither is the field's focus ring. */
	.line {
		display: flex;
		align-items: center;
		height: 17px;
		white-space: nowrap;
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
