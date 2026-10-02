<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	import { onMount } from "svelte";
	import { replaceState } from "$app/navigation";
	import { decode, encode } from "$lib/codec";
	import { KernelMorph, MAX_SEED, next_seed, with_contrast } from "$lib/kernel";
	import { DEFAULT_SETTINGS, PARAMS, type Param, SLIDERS, type Settings, type Slider, VIEWS, type View, position_of, value_at } from "$lib/settings";
	import { Simulation } from "$lib/simulation";
	import { local_storage } from "$lib/storage";
	import { THEMES, type Theme, ThemeChoice, parse_theme } from "$lib/theme.svelte";

	let settings   = $state<Settings>({ ...DEFAULT_SETTINGS });
	let paused     = $state(false);
	let steps      = $state(0);
	let show_card  = $state(true);
	let fade       = $state(true);
	let opacity    = $state(1);
	/** Steps until the next kernel, while morphing. */
	let next_in    = $state(0);
	const theme    = new ThemeChoice(local_storage());

	let canvas: HTMLCanvasElement;
	let chrome: HTMLElement;
	let sim: Simulation | undefined;
	// The page is prerendered with some kernel; the URL's, or a random one, takes over once mounted.
	const morph = new KernelMorph(0);
	/** The morph's seed, as reactive state. */
	let seed    = $state(0);
	const encoded = $derived(encode(settings, seed));

	// Within NEAR px of the controls they're opaque; by FAR px away they've faded out.
	const NEAR = 24;
	const FAR  = 240;

	// The address bar follows along, so a URL reproduces the settings and the kernel. Debounced:
	// Safari refuses more than 100 replaceState calls in 30 seconds, and a slider makes many.
	$effect(() => {
		const url  = new URL(location.href);
		url.search = encoded;
		const timer = setTimeout(() => replaceState(url, {}), 300);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (theme.theme === "system") {
			delete document.documentElement.dataset["theme"];
		} else {
			document.documentElement.dataset["theme"] = theme.theme;
		}
	});

	function restart(): void {
		sim?.restart(window.innerWidth, window.innerHeight, settings.ground);
	}

	function step(): void {
		if (settings.morph) {
			morph.advance(settings.morph_steps);
		}
		sim!.step({
			kernel:      with_contrast(morph.kernel, settings.contrast),
			tap_spacing: settings.spacing,
			jitter:      settings.jitter,
			persistence: settings.persistence,
		});
		steps++;
	}

	/** Jumps to the kernel numbered `to`, wrapping around past either end. */
	function jump(to: number): void {
		morph.jump(to >>> 0);
		seed = morph.seed;
	}

	function new_kernel(): void {
		jump(Math.floor(Math.random() * 1_000_000));
	}

	/** Takes a typed seed once the user is done with it, rather than every half-typed number. */
	function commit_seed(event: Event & { currentTarget: HTMLInputElement }): void {
		const typed = event.currentTarget.valueAsNumber;
		if (Number.isInteger(typed) && typed >= 0 && typed <= MAX_SEED) {
			jump(typed);
		}
		event.currentTarget.value = String(seed);
	}

	function step_once(): void {
		step();
		sim!.draw(settings.view);
	}

	onMount(() => {
		const decoded = decode(location.search);
		settings = decoded.settings;
		if (decoded.seed === null) {
			new_kernel();
		} else {
			jump(decoded.seed);
		}
		sim = new Simulation(canvas);
		restart();
		// A lost WebGL context loses the buffers (and three.js's clear color), so it restarts.
		canvas.addEventListener("webglcontextrestored", restart);

		let frame = 0;
		let frame_request = 0;
		/** Steps as many times as the speed asks for this display frame, then shows the result. */
		function loop(): void {
			frame_request = requestAnimationFrame(loop); // First, so an exception doesn't stop the loop
			if (!paused) {
				const count = settings.speed >= 1 ? settings.speed : Number(frame % Math.round(1 / settings.speed) === 0);
				for (let i = 0; i < count; i++) {
					step();
				}
			}
			frame++;
			seed    = morph.seed;
			next_in = Math.ceil((1 - morph.progress) * settings.morph_steps);
			sim!.draw(settings.view);
		}
		loop();
		return () => cancelAnimationFrame(frame_request);
	});

	/** Gives a slider's setting the value at its new position. */
	function slide(key: keyof typeof SLIDERS, event: Event & { currentTarget: HTMLInputElement }): void {
		settings[key] = value_at(SLIDERS[key], event.currentTarget.valueAsNumber);
	}

	function on_ground(event: Event & { currentTarget: HTMLInputElement }): void {
		slide("ground", event);
		restart();
	}

	/** The settings given to the mouse follow it, and the controls fade with distance from it. */
	function on_pointer_move(event: PointerEvent): void {
		if (event.pointerType === "touch") {
			return;
		}
		const box = chrome.getBoundingClientRect();
		const dx  = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
		const dy  = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
		const distance = Math.hypot(dx, dy);
		opacity = 1 - Math.min(1, Math.max(0, (distance - NEAR) / (FAR - NEAR)));
		if (distance > 0) {
			follow(settings.mouse_x, event.clientX / window.innerWidth);
			follow(settings.mouse_y, event.clientY / window.innerHeight);
		}
	}

	/**
	 * Moves a setting's slider to the pointer's place across the window.
	 * @param along 0 at the left or top, 1 at the right or bottom.
	 */
	function follow(param: Param | null, along: number): void {
		if (param !== null) {
			const slider: Slider = SLIDERS[param];
			settings[param] = value_at(slider, Math.round(along * slider.positions));
		}
	}

	/** The pointer left the window. */
	function on_mouse_out(event: MouseEvent): void {
		if (event.relatedTarget === null) {
			opacity = 0;
		}
	}

	function toggle_pause(): void {
		paused = !paused;
	}

	/** Space pauses and Enter steps, except where they already mean something. */
	function on_key(event: KeyboardEvent): void {
		if (event.target instanceof Element && event.target.closest("input, select, button, textarea, summary")) {
			return;
		}
		if (event.code === "Space") {
			event.preventDefault();
			toggle_pause();
		} else if (event.code === "Enter" && paused) {
			step_once();
		}
	}

	function format_speed(speed: number): string {
		return speed >= 1 ? `${speed} per frame` : `1 per ${Math.round(1 / speed)} frames`;
	}

	const PARAM_LABELS: Record<Param, string> = { contrast: "Contrast", spacing: "Spacing", jitter: "Jitter", persistence: "Persistence" };
	const VIEW_LABELS:  Record<View, string>  = { color: "Color", red: "Red", green: "Green", blue: "Blue", change: "Change", clipped: "Clipped" };
	const THEME_LABELS: Record<Theme, string> = { system: "Browser's theme", light: "Light", dark: "Dark" };
</script>

<svelte:head>
	<title>r_g_b.html by v21</title>
</svelte:head>

<svelte:window onpointermove={on_pointer_move} onmouseout={on_mouse_out} onkeydown={on_key} onresize={restart} />

<canvas bind:this={canvas} onclick={new_kernel}></canvas>

<div class="chrome" bind:this={chrome} style:opacity={fade ? opacity : 1}>
	<button type="button" class="toggle" onclick={() => (show_card = !show_card)}>{show_card ? "Hide controls" : "Show controls"}</button>

	{#if show_card}
		<section class="card">
			<header class="actions">
				<button type="button" onclick={toggle_pause}>{paused ? "Play" : "Pause"}</button>
				<button type="button" onclick={step_once} disabled={!paused}>Step</button>
				<button type="button" onclick={restart}>Restart</button>
				<button type="button" onclick={new_kernel}>New kernel</button>
			</header>

			<form onsubmit={(e) => e.preventDefault()}>
				<fieldset>
					<legend>Kernel</legend>
					<div class="row">
						<span>Number</span>
						<div class="seed">
							<button type="button" onclick={() => jump(seed - 1)} aria-label="Previous kernel">‹</button>
							<input type="number" min="0" max={MAX_SEED} step="1" value={seed} onchange={commit_seed} aria-label="Kernel number" />
							<button type="button" onclick={() => jump(seed + 1)} aria-label="Next kernel">›</button>
						</div>
						<output>{settings.morph ? `to ${next_seed(seed)}` : ""}</output>
					</div>
					<label class="row">
						<span>Contrast</span>
						<input type="range" min="0" max={SLIDERS.contrast.positions} value={position_of(SLIDERS.contrast, settings.contrast)} oninput={(e) => slide("contrast", e)} />
						<output>{settings.contrast.toFixed(2)}×</output>
					</label>
					<div class="row">
						<label class="check"><input type="checkbox" bind:checked={settings.morph} /> Morph</label>
						<input type="range" min="0" max={SLIDERS.morph_steps.positions} value={position_of(SLIDERS.morph_steps, settings.morph_steps)} oninput={(e) => slide("morph_steps", e)}
							disabled={!settings.morph} aria-label="Steps per kernel" aria-valuetext="{settings.morph_steps} steps" />
						<output>{settings.morph_steps} steps</output>
					</div>
					{#if settings.morph}
						<p class="muted">Next kernel in {next_in} steps.</p>
					{/if}
				</fieldset>

				<fieldset>
					<legend>Taps</legend>
					<label class="row">
						<span>Spacing</span>
						<input type="range" min="0" max={SLIDERS.spacing.positions} value={position_of(SLIDERS.spacing, settings.spacing)} oninput={(e) => slide("spacing", e)}
							aria-valuetext="{settings.spacing} px" />
						<output>{settings.spacing.toFixed(1)} px</output>
					</label>
					<label class="row">
						<span>Jitter</span>
						<input type="range" min="0" max={SLIDERS.jitter.positions} value={position_of(SLIDERS.jitter, settings.jitter)} oninput={(e) => slide("jitter", e)}
							aria-valuetext="{(settings.jitter * 100).toFixed(1)}%" />
						<output>±{(settings.jitter * 100).toFixed(1)}%</output>
					</label>
					<label class="row">
						<span>Persistence</span>
						<input type="range" min="0" max={SLIDERS.persistence.positions} value={position_of(SLIDERS.persistence, settings.persistence)} oninput={(e) => slide("persistence", e)}
							aria-valuetext="{(settings.persistence * 100).toFixed(1)}%" />
						<output>{(settings.persistence * 100).toFixed(1)}%</output>
					</label>
				</fieldset>

				<fieldset>
					<legend>Time</legend>
					<label class="row">
						<span>Speed</span>
						<input type="range" min="0" max={SLIDERS.speed.positions} value={position_of(SLIDERS.speed, settings.speed)} oninput={(e) => slide("speed", e)}
							aria-valuetext={format_speed(settings.speed)} />
						<output>{format_speed(settings.speed)}</output>
					</label>
					<p class="muted">Step {steps}.</p>
				</fieldset>

				<fieldset>
					<legend>Start</legend>
					<label class="row">
						<span>Ground</span>
						<input type="range" min="0" max={SLIDERS.ground.positions} value={position_of(SLIDERS.ground, settings.ground)} oninput={on_ground} />
						<output>{settings.ground.toFixed(3)}</output>
					</label>
				</fieldset>

				<fieldset>
					<legend>View</legend>
					<div class="choices">
						{#each VIEWS as view (view)}
							<label><input type="radio" name="view" bind:group={settings.view} value={view} /> {VIEW_LABELS[view]}</label>
						{/each}
					</div>
				</fieldset>

				<fieldset>
					<legend>Pointer</legend>
					<div class="row">
						<span>Mouse</span>
						<div class="choices">
							<label>X <select bind:value={settings.mouse_x}>
								<option value={null}>nothing</option>
								{#each PARAMS as param (param)}
									<option value={param}>{PARAM_LABELS[param]}</option>
								{/each}
							</select></label>
							<label>Y <select bind:value={settings.mouse_y}>
								<option value={null}>nothing</option>
								{#each PARAMS as param (param)}
									<option value={param}>{PARAM_LABELS[param]}</option>
								{/each}
							</select></label>
						</div>
					</div>
					<div class="row">
						<span>Controls</span>
						<div class="choices">
							<label><input type="checkbox" bind:checked={fade} /> Fade when the pointer is away</label>
						</div>
					</div>
				</fieldset>
			</form>

			<footer class="actions">
				<label class="theme">
					<span>Theme</span>
					<select value={theme.theme} onchange={(e) => theme.set(parse_theme(e.currentTarget.value))}>
						{#each THEMES as option (option)}
							<option value={option}>{THEME_LABELS[option]}</option>
						{/each}
					</select>
				</label>
			</footer>
		</section>
	{/if}
</div>

<style>
	/* The simulation is sized in CSS pixels, so on HiDPI it's upscaled, pixelated. A touch drag
	   on it is the page's, not the browser's. */
	canvas {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
		touch-action: none;
	}

	/* The corner button and the card under it, which fade together as the pointer leaves them.
	   Keyboard focus keeps them up. The card scrolls if the window is short. */
	.chrome {
		position: fixed;
		top:  calc(16px + env(safe-area-inset-top));
		left: calc(16px + env(safe-area-inset-left));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		max-height: calc(100% - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
		transition: opacity 0.15s;
	}
	.chrome:has(:focus-visible) {
		opacity: 1 !important;
	}

	.card {
		width: min(380px, calc(100vw - 32px));
		overflow-y: auto;
		background: var(--card);
		padding: 8px 16px 12px;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15), 0 8px 24px rgb(0 0 0 / 0.08);
	}

	.muted {
		color: var(--text-muted);
		font-size: 12px;
		margin: 2px 0 4px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		margin: 4px 0;
	}

	.theme {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
		font-size: 12px;
	}
	select {
		padding: 1px 2px;
		background: var(--card);
		border: 1px solid var(--rule-strong);
		border-radius: 0;
	}

	fieldset {
		border: 0;
		border-top: 1px solid var(--rule);
		margin: 6px 0 0;
		padding: 4px 0 2px;
	}
	legend {
		padding: 0 8px 0 0;
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.row {
		display: grid;
		grid-template-columns: 6.5em 1fr 6.5em;
		gap: 10px;
		align-items: center;
		margin: 4px 0;
	}
	.row > span:first-child, .row > .check {
		font-size: 12px;
	}
	/* A row of choices has no readout, so it runs to the edge. */
	.row > .choices {
		grid-column: 2 / -1;
	}
	.row output {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		text-align: right;
		white-space: nowrap;
	}

	.check, .choices label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		font-size: 12px;
	}
	input[type="checkbox"] {
		margin: 0;
	}

	.seed {
		display: flex;
		gap: 4px;
	}
	.seed input {
		flex: 1;
		min-width: 0;
		padding: 1px 6px;
		background: var(--card);
		border: 1px solid var(--rule-strong);
		font-variant-numeric: tabular-nums;
	}
	.seed button {
		padding: 0 8px;
	}

	/* Sliders are a bar with a thin thumb. */
	input[type="range"] {
		appearance: none;
		width: 100%;
		height: 12px;
		margin: 0;
		background: var(--rule);
		border: 1px solid var(--rule-strong);
	}
	input[type="range"]:disabled {
		opacity: 0.4;
	}
	input[type="range"]::-webkit-slider-thumb {
		appearance: none;
		width: 8px;
		height: 18px;
		background: var(--card);
		border: 1px solid var(--text);
	}
	input[type="range"]::-moz-range-thumb {
		width: 6px;
		height: 16px;
		background: var(--card);
		border: 1px solid var(--text);
		border-radius: 0;
	}
</style>
