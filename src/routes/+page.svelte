<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	import { onMount } from "svelte";
	import { replaceState } from "$app/navigation";
	import GrowthMap from "$lib/GrowthMap.svelte";
	import KernelDiagram from "$lib/KernelDiagram.svelte";
	import TapsOverlay from "$lib/TapsOverlay.svelte";
	import { type KernelName, decode, encode } from "$lib/codec";
	import { type Kernel, Kernels, MAX_SEED, PRESETS, type Preset, type Source, next_seed, with_contrast, with_drift, with_weight } from "$lib/kernel";
	import { CLICKS, type Click, DEFAULT_SETTINGS, LIKE_R_G_B, MOUSE_TARGETS, type MouseTarget, PIXEL_SIZES, SEEDS, SLIDERS, type Seeds, type Settings, type Slider, VIEWS, type View, position_of, value_at } from "$lib/settings";
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
	const kernels = new Kernels(0);
	/** The kernels' source and kernel as reactive state, which sync() updates. */
	let source    = $state.raw<Source>(kernels.source);
	let base      = $state.raw<Kernel>(kernels.kernel);
	/** The last random kernel, which choosing Random goes back to; the current one while random. */
	let last_seed: number | null = null;
	/** The kernel the step uses: the base, with the drift and contrast applied. */
	const shown   = $derived(shape(base));
	const model   = $derived({ kernel: shown, spacing: settings.spacing, jitter: settings.jitter, persistence: settings.persistence });
	let map_caption = $state("");
	const encoded = $derived(encode(settings, name_of(source, base)));
	const PRESET_NAMES = Object.keys(PRESETS) as Preset[];

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

	/** The simulation's size in its own pixels, which cover the window, maybe with some to spare. */
	let width  = $state(0);
	let height = $state(0);

	/**
	 * Starts again from the ground, noise and seeds.
	 * @param wave Faint stripes to add, in cycles per pixel across and up.
	 */
	function restart(wave?: { fx: number; fy: number }): void {
		const w = Math.ceil(window.innerWidth / settings.pixel);
		const h = Math.ceil(window.innerHeight / settings.pixel);
		sim?.restart({ width: w, height: h, ground: settings.ground, noise: settings.noise, seeds: settings.seeds, float: settings.float, wave });
		// Written, not read, so the effect below doesn't depend on them.
		width  = w;
		height = h;
	}

	// The settings of what a restart starts from restart it when they change.
	$effect(() => restart());

	/** The kernel with the drift and contrast settings applied. */
	function shape(kernel: Kernel): Kernel {
		return with_contrast(with_drift(kernel, settings.drift), settings.contrast);
	}

	/** The kernel as the URL names it. */
	function name_of(from: Source, kernel: Kernel): KernelName {
		return from.kind === "seed" ? from.seed : from.kind === "preset" ? from.name : kernel;
	}

	/** When sync() last ran, in performance.now() milliseconds. */
	let synced_at = 0;
	/** How often a morphing kernel is shown: more often would redraw the diagram and map for little. */
	const SYNC_MS = 100;

	/** Copies the kernels' state to the page's. */
	function sync(): void {
		synced_at = performance.now();
		source  = kernels.source;
		base    = kernels.kernel;
		next_in = Math.ceil((1 - kernels.progress) * settings.morph_steps);
		if (source.kind === "seed") {
			last_seed = source.seed;
		}
	}

	function step(): void {
		if (settings.morph) {
			kernels.advance(settings.morph_steps);
		}
		sim!.step({
			kernel:      shape(kernels.kernel),
			stamp:       settings.stamp,
			tap_spacing: settings.spacing,
			jitter:      settings.jitter,
			persistence: settings.persistence,
		});
		steps++;
	}

	/** Jumps to the random kernel numbered `to`, wrapping around past either end. */
	function jump(to: number): void {
		kernels.jump(to >>> 0);
		sync();
	}

	/** Goes back to random kernels, or to a preset; a preset is shown as it is, without drift or contrast. */
	function choose(choice: string): void {
		const preset = PRESET_NAMES.find((name) => name === choice);
		if (preset === undefined) {
			jump(last_seed ?? random_seed());
			return;
		}
		kernels.choose(preset);
		settings.contrast = 1;
		settings.drift    = 1;
		sync();
	}

	/** Sets a weight of the kernel as shown, which becomes the kernel, without drift or contrast. */
	function edit_weight(index: number, weight: number): void {
		kernels.edit(with_weight(shown, index, weight));
		settings.contrast = 1;
		settings.drift    = 1;
		sync();
	}

	/** A random kernel number, small enough to read. */
	function random_seed(): number {
		return Math.floor(Math.random() * 1_000_000);
	}

	function new_kernel(): void {
		jump(random_seed());
	}

	/** Takes a typed seed once the user is done with it, rather than every half-typed number. */
	function commit_seed(event: Event & { currentTarget: HTMLInputElement }): void {
		const typed = event.currentTarget.valueAsNumber;
		if (Number.isInteger(typed) && typed >= 0 && typed <= MAX_SEED) {
			jump(typed);
		}
		event.currentTarget.value = String(last_seed ?? "");
	}

	function step_once(): void {
		step();
		sync();
		sim!.draw(settings.view);
	}

	onMount(() => {
		const decoded = decode(location.search);
		settings = decoded.settings;
		const named = decoded.kernel;
		if (named === null) {
			new_kernel();
		} else if (typeof named === "number") {
			jump(named);
		} else if (typeof named === "string") {
			kernels.choose(named);
		} else {
			kernels.edit(named);
		}
		sync();
		sim = new Simulation(canvas);
		restart();
		// A lost WebGL context loses the buffers, so it restarts.
		canvas.addEventListener("webglcontextrestored", () => restart());

		let frame = 0;
		let frame_request = 0;
		/** Steps as many times as the speed asks for this display frame, then shows the result. */
		function loop(): void {
			frame_request = requestAnimationFrame(loop); // First, so an exception doesn't stop the loop
			const count = paused ? 0 : settings.speed >= 1 ? settings.speed : Number(frame % Math.round(1 / settings.speed) === 0);
			for (let i = 0; i < count; i++) {
				step();
			}
			if (count > 0 && (kernels.source !== source || performance.now() - synced_at >= SYNC_MS)) {
				sync();
			}
			frame++;
			sim!.draw(settings.view);
		}
		loop();
		return () => cancelAnimationFrame(frame_request);
	});

	/** Gives a slider's setting the value at its new position. */
	function slide(key: keyof typeof SLIDERS, event: Event & { currentTarget: HTMLInputElement }): void {
		settings[key] = value_at(SLIDERS[key], event.currentTarget.valueAsNumber);
	}

	/** Puts the settings back to some set of them; the kernel stays, but a preset or edit goes back to random for r_g_b.html. */
	function reset(to: Settings): void {
		settings = { ...to };
		if (to === LIKE_R_G_B && source.kind !== "seed") {
			jump(last_seed ?? random_seed());
		}
	}

	/** Where the screen pixel at `x`, `y` from the top left is in the simulation, from the bottom left. */
	function to_buffer(x: number, y: number): { x: number; y: number } {
		return { x: x / settings.pixel, y: height - y / settings.pixel };
	}

	/** The last point of a stroke being painted, in the simulation's pixels. */
	let stroke: { x: number; y: number } | null = null;
	/** The screen pixel whose taps are shown, if any. */
	let taps_at = $state<{ x: number; y: number } | null>(null);

	/** `level`, 0 to 1, as a gray "#rrggbb". */
	function gray(level: number): string {
		return "#" + Math.round(level * 255).toString(16).padStart(2, "0").repeat(3);
	}

	/** Paints from the stroke's last point to the pointer, or starts a stroke there. */
	function paint_to(event: PointerEvent): void {
		const at = to_buffer(event.clientX, event.clientY);
		sim?.paint(stroke ?? at, at, settings.brush, settings.click === "erase" ? gray(settings.ground) : settings.paint);
		stroke = at;
	}

	function on_canvas_down(event: PointerEvent & { currentTarget: HTMLCanvasElement }): void {
		if (settings.click === "paint" || settings.click === "erase") {
			event.currentTarget.setPointerCapture(event.pointerId);
			stroke = null;
			paint_to(event);
		}
	}

	function on_canvas_move(event: PointerEvent): void {
		if (stroke !== null) {
			paint_to(event);
		}
	}

	function on_canvas_click(event: MouseEvent): void {
		if (settings.click === "kernel") {
			new_kernel();
		} else if (settings.click === "taps") {
			taps_at = { x: event.clientX, y: event.clientY };
		}
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
	 * Moves what the mouse is given to the pointer's place across the window.
	 * @param along 0 at the left or top, 1 at the right or bottom.
	 */
	function follow(target: MouseTarget | null, along: number): void {
		if (target === "r_g_b") {
			// r_g_b.html's easeInExpo, and its spacing of up to a third of the height.
			const e = along === 0 ? 0 : Math.pow(2, 10 * along - 10);
			const spacing = (e * window.innerHeight) / settings.pixel / 3;
			settings.spacing     = Number(Math.min(SLIDERS.spacing.max, Math.max(SLIDERS.spacing.min, spacing)).toPrecision(4));
			settings.persistence = Number(e.toPrecision(4));
		} else if (target !== null) {
			const slider: Slider = SLIDERS[target];
			settings[target] = value_at(slider, Math.round(along * slider.positions));
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

	const MOUSE_LABELS:  Record<MouseTarget, string> = { contrast: "Contrast", drift: "Drift", spacing: "Spacing", jitter: "Jitter", persistence: "Persistence", r_g_b: "Spacing + persistence" };
	const CLICK_LABELS:  Record<Click, string>  = { kernel: "New kernel", paint: "Paint", erase: "Erase", taps: "Show taps" };
	const PRESET_LABELS: Record<Preset, string> = { identity: "Identity", box: "Box blur", shift: "Shift", row: "One row", ring: "Center-surround", checker: "Checkerboard" };
	const SEED_LABELS:  Record<Seeds, string> = { rgb: "R G B dots", white: "White dot", pixel: "One pixel", none: "None" };
	const VIEW_LABELS:  Record<View, string>  = { color: "Color", red: "Red", green: "Green", blue: "Blue", change: "Change", clipped: "Clipped" };
	const THEME_LABELS: Record<Theme, string> = { system: "Browser's theme", light: "Light", dark: "Dark" };
</script>

<svelte:head>
	<title>r_g_b.html by v21</title>
</svelte:head>

<svelte:window onpointermove={on_pointer_move} onmouseout={on_mouse_out} onkeydown={on_key} onresize={() => restart()} />

<canvas bind:this={canvas} onclick={on_canvas_click} onpointerdown={on_canvas_down} onpointermove={on_canvas_move} onpointerup={() => (stroke = null)}
	style:width="{width * settings.pixel}px" style:height="{height * settings.pixel}px"></canvas>

{#if settings.click === "taps" && taps_at !== null}
	<TapsOverlay kernel={shown} spacing={settings.spacing} pixel={settings.pixel} at={taps_at} width={width * settings.pixel} height={height * settings.pixel} />
{/if}

<div class="chrome" bind:this={chrome} style:opacity={fade ? opacity : 1}>
	<button type="button" class="toggle" onclick={() => (show_card = !show_card)}>{show_card ? "Hide controls" : "Show controls"}</button>

	{#if show_card}
		<section class="card">
			<header class="actions">
				<button type="button" onclick={toggle_pause}>{paused ? "Play" : "Pause"}</button>
				<button type="button" onclick={step_once} disabled={!paused}>Step</button>
				<button type="button" onclick={() => restart()}>Restart</button>
				<button type="button" onclick={new_kernel}>New kernel</button>
			</header>

			<form onsubmit={(e) => e.preventDefault()}>
				<fieldset>
					<legend>Kernel</legend>
					<div class="row">
						<span>Kernel</span>
						<select class="wide" value={source.kind === "seed" ? "random" : source.kind === "preset" ? source.name : "edited"} onchange={(e) => choose(e.currentTarget.value)}>
							<option value="random">Random</option>
							{#each PRESET_NAMES as name (name)}
								<option value={name}>{PRESET_LABELS[name]}</option>
							{/each}
							{#if source.kind === "edited"}
								<option value="edited" disabled>Edited</option>
							{/if}
						</select>
					</div>
					{#if source.kind === "seed"}
						<div class="row">
							<span>Number</span>
							<div class="seed">
								<button type="button" onclick={() => jump((last_seed ?? 0) - 1)} aria-label="Previous kernel">‹</button>
								<input type="number" min="0" max={MAX_SEED} step="1" value={source.seed} onchange={commit_seed} aria-label="Kernel number" />
								<button type="button" onclick={() => jump((last_seed ?? 0) + 1)} aria-label="Next kernel">›</button>
							</div>
							<output>{settings.morph ? `to ${next_seed(source.seed)}` : ""}</output>
						</div>
						<div class="row">
							<label class="check"><input type="checkbox" bind:checked={settings.morph} /> Morph</label>
							<input type="range" min="0" max={SLIDERS.morph_steps.positions} value={position_of(SLIDERS.morph_steps, settings.morph_steps)} oninput={(e) => slide("morph_steps", e)}
								disabled={!settings.morph} aria-label="Steps per kernel" aria-valuetext="{settings.morph_steps} steps" />
							<output>{settings.morph_steps} steps</output>
						</div>
						{#if settings.morph}
							<p class="muted">Next kernel in {next_in} steps.</p>
						{/if}
					{/if}
					<div class="figures">
						<KernelDiagram kernel={shown} onedit={edit_weight} />
						<GrowthMap model={model} theme={theme.theme} onplant={(fx, fy) => restart({ fx, fy })} bind:caption={map_caption} />
					</div>
					<p class="muted">{map_caption}</p>
					<label class="row">
						<span>Contrast</span>
						<input type="range" min="0" max={SLIDERS.contrast.positions} value={position_of(SLIDERS.contrast, settings.contrast)} oninput={(e) => slide("contrast", e)} />
						<output>{settings.contrast.toFixed(2)}×</output>
					</label>
					<label class="row">
						<span>Drift</span>
						<input type="range" min="0" max={SLIDERS.drift.positions} value={position_of(SLIDERS.drift, settings.drift)} oninput={(e) => slide("drift", e)} />
						<output>{settings.drift.toFixed(2)}×</output>
					</label>
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
					<div class="row">
						<span>Seeds</span>
						<div class="choices">
							{#each SEEDS as seeds (seeds)}
								<label><input type="radio" name="seeds" bind:group={settings.seeds} value={seeds} /> {SEED_LABELS[seeds]}</label>
							{/each}
							<label><input type="checkbox" bind:checked={settings.stamp} /> Stamped every step</label>
						</div>
					</div>
					<label class="row">
						<span>Ground</span>
						<input type="range" min="0" max={SLIDERS.ground.positions} value={position_of(SLIDERS.ground, settings.ground)} oninput={(e) => slide("ground", e)} />
						<output>{settings.ground.toFixed(3)}</output>
					</label>
					<label class="row">
						<span>Noise</span>
						<input type="range" min="0" max={SLIDERS.noise.positions} value={position_of(SLIDERS.noise, settings.noise)} oninput={(e) => slide("noise", e)}
							aria-valuetext="plus or minus {settings.noise}" />
						<output>±{settings.noise.toFixed(3)}</output>
					</label>
					<div class="row">
						<span>Pixel size</span>
						<div class="choices">
							{#each PIXEL_SIZES as pixel (pixel)}
								<label><input type="radio" name="pixel" bind:group={settings.pixel} value={pixel} /> {pixel}</label>
							{/each}
							<label><input type="checkbox" bind:checked={settings.float} /> Float buffers</label>
						</div>
					</div>
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
							{#each [["X", "mouse_x"], ["Y", "mouse_y"]] as const as [axis, key] (key)}
								<label>{axis} <select bind:value={settings[key]}>
									<option value={null}>nothing</option>
									{#each MOUSE_TARGETS as target (target)}
										<option value={target}>{MOUSE_LABELS[target]}</option>
									{/each}
								</select></label>
							{/each}
						</div>
					</div>
					<div class="row">
						<span>Click</span>
						<div class="choices">
							{#each CLICKS as click (click)}
								<label><input type="radio" name="click" bind:group={settings.click} value={click} /> {CLICK_LABELS[click]}</label>
							{/each}
						</div>
					</div>
					{#if settings.click === "paint" || settings.click === "erase"}
						<label class="row">
							<span>Brush</span>
							<input type="range" min="0" max={SLIDERS.brush.positions} value={position_of(SLIDERS.brush, settings.brush)} oninput={(e) => slide("brush", e)}
								aria-valuetext="{settings.brush} px" />
							<output>{settings.brush} px</output>
						</label>
					{/if}
					{#if settings.click === "paint"}
						<label class="row">
							<span>Color</span>
							<input type="color" bind:value={settings.paint} />
							<output>{settings.paint}</output>
						</label>
					{/if}
					<div class="row">
						<span>Controls</span>
						<div class="choices">
							<label><input type="checkbox" bind:checked={fade} /> Fade when the pointer is away</label>
						</div>
					</div>
				</fieldset>
			</form>

			<footer class="actions">
				<button type="button" onclick={() => reset(DEFAULT_SETTINGS)}>Reset settings</button>
				<button type="button" onclick={() => reset(LIKE_R_G_B)}>Like r_g_b.html</button>
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
	/* The simulation's pixels are whole CSS pixels, so on HiDPI and at bigger pixel sizes it's
	   upscaled, pixelated; its size is set inline. A touch drag on it is the page's, not the
	   browser's. */
	canvas {
		position: fixed;
		top: 0;
		left: 0;
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
		grid-template-columns: 6.5em minmax(0, 1fr) 6.5em;
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
	input[type="color"] {
		width: 100%;
		height: 20px;
		padding: 0 2px;
		background: var(--card);
		border: 1px solid var(--rule-strong);
	}

	.wide {
		grid-column: 2 / -1;
		min-width: 0;
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 12px 24px;
		margin: 6px 0 0;
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
