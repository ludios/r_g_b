<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	// The kernel as a Hinton diagram: each tap's weight as a square, laid out as the taps are on
	// screen, whose area is the weight's size, filled if positive and hollow if negative; past 1
	// either way, the square fills its cell in the accent color. Dragging
	// a square up or down changes its weight, and clicking one, or choosing it with the arrow keys,
	// gives a field to type it in; the taps that change with it are outlined. The middle tap is
	// whatever makes the sum 1, so it follows the others rather than being edited itself.
	import { tick } from "svelte";
	import { type Group, type Kernel, MIDDLE, TAPS, group_of, index_of, reweighted, tap_offset } from "./kernel";

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
	/** Which way each arrow key moves the selection across the taps; up is +y. */
	const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

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
	let diagram  = $state<SVGSVGElement>();
	/** Whether the diagram itself has the keyboard's focus, so the arrow keys choose taps. */
	let focused  = $state(false);
	/**
	 * The tap pressed, by which pointer, and where; once it's moved far enough to be a drag, where
	 * that started, the kernel then, and the kernel it last made.
	 */
	let press: { pointer: number; index: number; y: number; from: Kernel | null; last: Kernel | null } | null = null;

	/** The tap the caption describes. */
	const subject = $derived(dragged ?? selected ?? hover);
	/** The taps that change with the subject. */
	const linked  = $derived(subject === null || subject === MIDDLE ? [] : group_of(subject, group));

	/** The top left of tap `i`'s cell: row 0 of a kernel is the bottom row. */
	function cell(i: number): { x: number; y: number } {
		return { x: (tap_offset(i).x + 2) * CELL, y: (2 - tap_offset(i).y) * CELL };
	}

	/** Whether a weight is too big for its square to show by area. */
	function over(weight: number): boolean {
		return Math.abs(weight) > 1;
	}

	/**
	 * A square's side: by area, up to most of the cell at 1; past that, all of the cell but a pixel
	 * each side, which keeps a hollow square's stroke inside it.
	 */
	function side(weight: number): number {
		return over(weight) ? CELL - 2 : CELL * 0.9 * Math.sqrt(Math.abs(weight));
	}

	/** Where tap `i` reads from, in taps from the pixel itself; up is +y. */
	function offset(i: number): string {
		return `(${tap_offset(i).x}, ${tap_offset(i).y})`;
	}

	/** A weight to three places, where one too small to show is 0, not -0. */
	function format(weight: number): string {
		const text = weight.toFixed(3);
		return text === "-0.000" ? "0.000" : text;
	}

	/**
	 * Presses tap `index` with the primary button of the primary pointer (not a second finger),
	 * first taking what's typed, as leaving the field would. A press whose end never came is
	 * forgotten.
	 */
	function down(event: PointerEvent, index: number): void {
		if (event.button !== 0 || !event.isPrimary) {
			return;
		}
		take_draft();
		event.preventDefault();
		diagram!.setPointerCapture(event.pointerId);
		press = { pointer: event.pointerId, index, y: event.clientY, from: null, last: null };
	}

	/**
	 * Once a press has moved far enough up or down, drags the tap's weight, and its group's, with it.
	 * A move without the button held ends a press whose pointerup never came.
	 */
	function move(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointer) {
			return;
		}
		if ((event.buttons & 1) === 0) {
			release(event);
			return;
		}
		if (press.index === MIDDLE) {
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
		press.last  = reweighted(press.from, group_of(press.index, group), (k) => k + delta);
		onedit(press.last, true);
	}

	/**
	 * Ends the pointer's press, on pointerup or otherwise. A drag hands on the kernel it ended with
	 * as done; a press that didn't drag and ended in pointerup was a click, which selects its tap
	 * or, if it already was or it's the middle, unselects it.
	 */
	function release(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointer) {
			return;
		}
		if (press.last !== null) {
			onedit(press.last, false);
		} else if (event.type === "pointerup") {
			draft    = null;
			selected = selected === press.index || press.index === MIDDLE ? null : press.index;
			// On a touchscreen, focus would put up a keyboard over the screen. With nothing selected,
			// the arrow keys go on from here.
			if (event.pointerType === "mouse" && selected !== null) {
				hold();
				void tick().then(edit_field);
			} else if (event.pointerType === "mouse") {
				diagram?.focus({ preventScroll: true });
			}
		}
		press   = null;
		dragged = null;
	}

	/** Puts the focus in the field, its text selected, so what's typed replaces it. */
	function edit_field(): void {
		field?.focus();
		field?.select();
	}

	/**
	 * The tap an arrow key goes to from tap `from` by `dx`, `dy`: the next one that way, stepping
	 * over the middle, which can't be selected, or `from` itself at the edge.
	 */
	function step(from: number, dx: number, dy: number): number {
		let { x, y } = tap_offset(from);
		do {
			x += dx;
			y += dy;
		} while (x === 0 && y === 0);
		return Math.abs(x) > 2 || Math.abs(y) > 2 ? from : index_of(x, y);
	}

	/**
	 * On the diagram, the arrow keys choose a tap, starting from the middle; Enter, or the start of a
	 * number, goes to its field (the keystroke lands there); Escape unselects it, or with none
	 * selected, leaves the diagram. Keys it takes are marked as handled. Shortcuts with Ctrl, Alt or
	 * Command are the browser's.
	 */
	function on_diagram_key(event: KeyboardEvent): void {
		if (event.ctrlKey || event.altKey || event.metaKey) {
			return;
		}
		const arrow = ARROWS[event.key];
		if (arrow !== undefined) {
			event.preventDefault();
			selected = step(selected ?? MIDDLE, ...arrow);
		} else if (selected !== null && event.key === "Enter") {
			event.preventDefault();
			edit_field();
		} else if (selected !== null && /^[\d.-]$/.test(event.key)) {
			edit_field();
		} else if (event.key === "Escape") {
			event.preventDefault();
			if (selected === null) {
				diagram?.blur();
			}
			selected = null;
		}
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

	/** Enter takes what's typed, and Escape drops it and goes back to the diagram, the tap still selected. */
	function on_field_key(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			take_draft();
			hold();
		} else if (event.key === "Escape") {
			draft = null;
			diagram?.focus();
		}
	}
</script>

<figure>
	<div class="figure-title">Hinton diagram</div>
	<!-- An application role, as it handles its own keys; svelte-check doesn't count that as interactive. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<svg bind:this={diagram} viewBox="-1 -1 {5 * CELL + 2} {5 * CELL + 2}" width={5 * CELL + 2} height={5 * CELL + 2} tabindex="0" role="application"
		aria-label="The kernel's 25 weights: the arrow keys choose a tap, and a number sets it"
		onpointermove={move} onpointerup={release} onpointercancel={release} onpointerleave={() => (hover = null)}
		onkeydown={on_diagram_key} onfocus={() => (focused = diagram!.matches(":focus-visible"))} onblur={() => (focused = false)}>
		{#each { length: TAPS } as _, i (i)}
			{@const { x, y } = cell(i)}
			{@const w = kernel[i]!}
			{@const s = side(w)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g class="tap" class:middle={i === MIDDLE} onpointerdown={(e) => down(e, i)} onpointerenter={() => (hover = i)}>
				<rect class="cell" x={x} y={y} width={CELL} height={CELL} />
				<rect class="weight" class:negative={w < 0} class:over={over(w)} x={x + (CELL - s) / 2} y={y + (CELL - s) / 2} width={s} height={s} />
			</g>
		{/each}
		{#each [MIDDLE, ...linked] as i (i)}
			{@const { x, y } = cell(i)}
			<rect class="outline" class:middle={i === MIDDLE} x={x} y={y} width={CELL} height={CELL} />
		{/each}
	</svg>
	<figcaption>
		<div class="line">
			{#if subject === null}
				{focused ? "Arrows choose a tap." : "Drag or click to edit."}
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
	/* Drawn after every cell, so no neighbor's edge covers them. */
	.outline {
		fill: none;
		stroke: var(--text);
		pointer-events: none;
	}
	.outline.middle {
		stroke: var(--accent);
	}
	.weight {
		fill: var(--text);
	}
	.weight.negative {
		fill: none;
		stroke: var(--text);
		stroke-width: 1.5;
	}
	.weight.over {
		fill: var(--accent);
	}
	.weight.over.negative {
		fill: none;
		stroke: var(--accent);
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
