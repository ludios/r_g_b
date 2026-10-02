<!-- Model-output: Claude Opus 5.5 -->
<script lang="ts">
	import { getLogger } from "@logtape/logtape";
	import { A } from "ayy";
	import { onMount } from "svelte";
	import { replaceState } from "$app/navigation";
	import GrowthMap from "$lib/GrowthMap.svelte";
	import KernelDiagram from "$lib/KernelDiagram.svelte";
	import TapsOverlay from "$lib/TapsOverlay.svelte";
	import { type KernelName, decode, encode } from "$lib/codec";
	import { GROUPS, type Group, type Kernel, Kernels, MAX_SEED, PRESETS, type Preset, type Source, TRANSFORMS, type Transform, mutated, next_seed, with_contrast, with_drift } from "$lib/kernel";
	import { CLICKS, type Click, DEFAULT_SETTINGS, MOUSE_TARGETS, type MouseTarget, BIT_DEPTHS, PIXEL_SIZES, SEEDS, SETTINGS_PRESETS, SLIDERS, type Seeds, type Settings, type SettingsPreset, type Slider, VIEWS, type View, position_of, value_at } from "$lib/settings";
	import { Simulation } from "$lib/simulation";
	import { growing } from "$lib/spectrum";
	import { local_storage } from "$lib/storage";
	import { THEMES, type Theme, ThemeChoice, parse_theme } from "$lib/theme.svelte";

	const log = getLogger(["r_g_b", "page"]);

	let settings   = $state<Settings>({ ...DEFAULT_SETTINGS });
	let paused     = $state(false);
	let steps      = $state(0);
	let show_card  = $state(true);
	let fade       = $state(true);
	let opacity    = $state(1);
	/** Steps until the next kernel, while morphing. */
	let next_in    = $state(0);
	const theme    = new ThemeChoice(local_storage());
	const storage  = local_storage();
	const SECTIONS_KEY = "r_g_b-open-sections";
	/** The card's sections, and whether each starts open. */
	const SECTIONS = { how: false, presets: true, time: true, start: true, taps: true, kernel: true, pointer: true, view: true };
	type Section = keyof typeof SECTIONS;
	/** Which of the card's sections are open, kept in localStorage. */
	let open = $state(read_open());

	/** The sections' stored states, or where there are none (as when prerendering), their defaults. */
	function read_open(): Record<Section, boolean> {
		let stored: unknown = null;
		try {
			stored = JSON.parse(storage?.getItem(SECTIONS_KEY) ?? "null");
		} catch {
			// The defaults, then.
		}
		const states = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
		return Object.fromEntries(Object.entries(SECTIONS).map(([name, initially]) => [name, typeof states[name] === "boolean" ? states[name] : initially])) as Record<Section, boolean>;
	}

	$effect(() => {
		const states = JSON.stringify(open);
		try {
			storage?.setItem(SECTIONS_KEY, states);
		} catch {
			// Not kept past this page, then.
		}
	});

	let canvas: HTMLCanvasElement;
	let chrome: HTMLElement;
	// State, so the restart effect runs once there's a simulation to restart.
	let sim = $state.raw<Simulation | undefined>();
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
	/** How far the kernels' crossfade has gone, as reactive state, which sync() updates. */
	let progress  = $state(0);
	const encoded = $derived(encode(settings, name_of(source, base), settings.morph ? 0 : progress));
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
		sim?.restart({ width: w, height: h, ground: settings.ground, noise: settings.noise, seeds: settings.seeds, bit_depth: settings.bit_depth, wave });
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

	/** The kernel as the URL names it; a held crossfade's progress goes beside it. */
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
		source   = kernels.source;
		base     = kernels.kernel;
		progress = kernels.progress;
		next_in  = Math.ceil((1 - kernels.progress) * settings.morph_steps);
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

	/**
	 * Jumps to the random kernel numbered `to`, wrapping around past either end.
	 * @param along How far its crossfade has gone already, from 0 up to 1.
	 */
	function jump(to: number, along = 0): void {
		kernels.jump(to >>> 0, along);
		sync();
	}

	/**
	 * A kernel as it was, for undo: where it came from, how far a random one's crossfade had gone,
	 * and the drift and contrast it was shown with.
	 */
	interface KernelState {
		source: Source;
		kernel: Kernel;
		progress: number;
		contrast: number;
		drift: number;
	}

	/** Changes to the kernel that can be undone, latest last, and undone ones that can be redone. */
	const done: KernelState[] = [];
	const undone: KernelState[] = [];
	let can_undo = $state(false);
	let can_redo = $state(false);
	/** Steps back that undo keeps. */
	const UNDOS = 100;

	function now_state(): KernelState {
		return { source: kernels.source, kernel: kernels.kernel, progress: kernels.progress, contrast: settings.contrast, drift: settings.drift };
	}

	/** Remembers the kernel before a change, for undo. */
	function remember(): void {
		done.push(now_state());
		if (done.length > UNDOS) {
			done.shift();
		}
		undone.length = 0;
		can_undo = true;
		can_redo = false;
	}

	/** Goes back to a remembered kernel, a random one partway through its crossfade as it was. */
	function restore(state: KernelState): void {
		if (state.source.kind === "seed") {
			kernels.jump(state.source.seed, state.progress);
		} else if (state.source.kind === "preset") {
			kernels.choose(state.source.name);
		} else {
			kernels.edit(state.kernel);
		}
		settings.contrast = state.contrast;
		settings.drift    = state.drift;
		sync();
	}

	/** Moves the latest state from one stack to the other, putting the current one on the other. */
	function travel(from: KernelState[], to: KernelState[]): void {
		const state = from.pop();
		if (state !== undefined) {
			to.push(now_state());
			restore(state);
		}
		can_undo = done.length > 0;
		can_redo = undone.length > 0;
	}

	/** Goes back to random kernels, or to a preset; a preset is shown as it is, without drift or contrast. */
	function choose(choice: string): void {
		remember();
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

	/** Makes `kernel` the kernel, made from the one shown, so without drift or contrast of its own. */
	function take(kernel: Kernel, dragging = false): void {
		kernels.edit(kernel, dragging);
		settings.contrast = 1;
		settings.drift    = 1;
		sync();
	}

	/** Which taps an edit on the Hinton diagram changes together. */
	let group = $state<Group>("tap");

	function transform(name: Transform): void {
		remember();
		take(TRANSFORMS[name](shown));
	}

	function mutate(): void {
		remember();
		take(mutated(shown, 0.03, Math.random));
	}

	/**
	 * Makes a kernel that grows stripes of `fx`, `fy` cycles per pixel half again each step, with the
	 * taps as they are, unless that takes huge weights.
	 * @returns Whether it did.
	 */
	function grow(fx: number, fy: number): boolean {
		const kernel = growing(fx, fy, { spacing: settings.spacing, jitter: settings.jitter, persistence: settings.persistence }, 1.5);
		if (kernel === null) {
			log.info("no kernel with small weights grows stripes of {fx}, {fy} cycles per pixel", { fx, fy });
			return false;
		}
		remember();
		take(kernel);
		return true;
	}

	/** A random kernel number, small enough to read. */
	function random_seed(): number {
		return Math.floor(Math.random() * 1_000_000);
	}

	function new_kernel(): void {
		remember();
		jump(random_seed());
	}

	/** Takes a typed seed once the user is done with it, rather than every half-typed number. */
	function commit_seed(event: Event & { currentTarget: HTMLInputElement }): void {
		const typed = event.currentTarget.valueAsNumber;
		if (Number.isInteger(typed) && typed >= 0 && typed <= MAX_SEED) {
			remember();
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
			jump(random_seed()); // Not new_kernel(): there's nothing to undo back to
		} else if (typeof named === "number") {
			jump(named, decoded.progress);
		} else if (typeof named === "string") {
			kernels.choose(named);
		} else {
			kernels.edit(named);
		}
		sync();
		sim = new Simulation(canvas); // Which the restart effect starts
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
		// From the next frame, after the restart effect.
		frame_request = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame_request);
	});

	/** Gives a slider's setting the value at its new position. */
	function slide(key: keyof typeof SLIDERS, event: Event & { currentTarget: HTMLInputElement }): void {
		settings[key] = value_at(SLIDERS[key], event.currentTarget.valueAsNumber);
	}

	/** Puts the settings back to the defaults, which play like r_g_b.html; the kernel stays. */
	function reset(): void {
		settings = { ...DEFAULT_SETTINGS };
	}

	/** Makes a preset's changes to the settings; the rest stay, and so does the kernel. */
	function apply(preset: SettingsPreset): void {
		Object.assign(settings, SETTINGS_PRESETS[preset]);
	}

	/** Where the screen pixel at `x`, `y` from the top left is in the simulation, from the bottom left. */
	function to_buffer(x: number, y: number): { x: number; y: number } {
		return { x: x / settings.pixel, y: height - y / settings.pixel };
	}

	/** The last point of a stroke being painted, in the simulation's pixels. */
	let stroke: { x: number; y: number } | null = null;
	/** The screen pixel whose taps are shown, if any. */
	let taps_at = $state<{ x: number; y: number } | null>(null);

	/** Paints from the stroke's last point to the pointer, or starts a stroke there. */
	function paint_to(event: PointerEvent): void {
		const at = to_buffer(event.clientX, event.clientY);
		sim?.paint(stroke ?? at, at, settings.brush, settings.click === "erase" ? settings.ground : settings.paint);
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
			follow(settings.mouse_x, event.clientX / window.innerWidth, "x");
			follow(settings.mouse_y, event.clientY / window.innerHeight, "y");
		}
	}

	/**
	 * Whether the mouse, given `target` on `axis`, leaves it be: Contrast and Drift reshape the
	 * kernel, so they follow the mouse only while it's random, and a preset or an edited kernel stays
	 * as it was chosen or made.
	 */
	function mouse_frozen(target: MouseTarget | null, axis: "x" | "y"): boolean {
		return source.kind !== "seed" && (target === "contrast" || target === "drift" || (target === "r_g_b" && axis === "x"));
	}

	/**
	 * Moves what the mouse is given to the pointer's place across the window, but for Contrast and
	 * Drift while the kernel isn't random.
	 * @param along 0 at the left or top, 1 at the right or bottom.
	 * @param axis Which way `along` runs, for what r_g_b.html gave each.
	 */
	function follow(target: MouseTarget | null, along: number, axis: "x" | "y"): void {
		if (mouse_frozen(target, axis)) {
			return;
		}
		if (target === "r_g_b" && axis === "x") {
			settings.contrast = Number((0.8 + 3 * along).toPrecision(4));
		} else if (target === "r_g_b" || target === "spacing_persistence") {
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
		// Shows the kernel as it is, which may be up to SYNC_MS behind while running.
		sync();
	}

	/**
	 * Space pauses, Enter steps, and Z and shift-Z undo and redo, except where they already mean
	 * something, or a control has handled them.
	 */
	function on_key(event: KeyboardEvent): void {
		if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("input, select, button, textarea, summary, a[href]"))) {
			return;
		}
		// Keys by what they type, so Z is Z on any layout, and either Enter steps.
		if (event.key === " ") {
			event.preventDefault();
			// Holding it down would flip back and forth.
			if (!event.repeat) {
				toggle_pause();
			}
		} else if (event.key === "Enter" && paused) {
			step_once();
		} else if (event.key.toLowerCase() === "z" && !event.altKey) {
			event.preventDefault();
			if (event.shiftKey) {
				travel(undone, done);
			} else {
				travel(done, undone);
			}
		}
	}

	function format_speed(speed: number): string {
		return speed >= 1 ? `${speed} per frame` : `1 per ${Math.round(1 / speed)} frames`;
	}

	const MOUSE_LABELS:  Record<MouseTarget, string> = { contrast: "Contrast", drift: "Drift", spacing: "Spacing", jitter: "Jitter", persistence: "Persistence",
		spacing_persistence: "Spacing + persistence", r_g_b: "As r_g_b.html" };
	const CLICK_LABELS:  Record<Click, string>  = { kernel: "New kernel", paint: "Paint", erase: "Erase", taps: "Show taps" };
	const PRESET_LABELS: Record<Preset, string> = {
		identity: "Identity", box: "Box blur", shift: "Shift", lean: "Lean", skip: "Every other tap",
		row: "One row", saddle: "Saddle", ring: "Center-surround", circles: "Circles", pinwheel: "Pinwheel",
		dots: "Dots", hexagons: "Hexagons", sharpen: "Sharpen",
		checker: "Checkerboard", advect: "Advect", rise: "Rise", emboss: "Emboss",
	};
	const PRESET_GROUPS: [string, Preset[]][] = [
		["Nothing grows", ["identity", "box", "shift", "lean", "skip"]],
		["Stripes grow", ["row", "saddle", "ring", "circles", "pinwheel", "dots", "hexagons", "sharpen"]],
		["Stripes grow and move", ["checker", "advect", "rise", "emboss"]],
	];
	A.eq(PRESET_GROUPS.flatMap(([, names]) => names).toSorted().join(), PRESET_NAMES.toSorted().join());
	const GROUP_LABELS: Record<Group, string> = { tap: "one tap", pair: "a tap and the one opposite", ring: "a tap's whole ring" };
	const SEED_LABELS:  Record<Seeds, string> = { rgb: "R G B dots", white: "White dot", pixel: "One pixel", none: "None" };
	const VIEW_LABELS:  Record<View, string>  = { color: "Color", red: "Red", green: "Green", blue: "Blue", change: "Change", clipped: "Clipped" };
	/** The View section's lines: the picture and its channels, then what the last step did, from Change on. */
	const VIEW_LINES = [VIEWS.slice(0, VIEWS.indexOf("change")), VIEWS.slice(VIEWS.indexOf("change"))];
	const THEME_LABELS: Record<Theme, string> = { system: "Browser's theme", light: "Light", dark: "Dark" };
	/** The settings presets' labels, in the order of their buttons. */
	const SETTINGS_PRESET_LABELS: Record<SettingsPreset, string> = { still: "No mouse", paint: "Paint", noise: "From noise", gray: "Black and white" };
	const SETTINGS_PRESET_NAMES = Object.keys(SETTINGS_PRESET_LABELS) as SettingsPreset[];
</script>

<svelte:head>
	<title>r_g_b.html by v21</title>
</svelte:head>

<svelte:window onpointermove={on_pointer_move} onmouseout={on_mouse_out} onkeydown={on_key} onresize={() => restart()} />

<canvas bind:this={canvas} onclick={on_canvas_click} onpointerdown={on_canvas_down} onpointermove={on_canvas_move}
	onpointerup={() => (stroke = null)} onpointercancel={() => (stroke = null)} onlostpointercapture={() => (stroke = null)}
	style:width="{width * settings.pixel}px" style:height="{height * settings.pixel}px"></canvas>

{#if settings.click === "taps" && taps_at !== null}
	<TapsOverlay kernel={shown} spacing={settings.spacing} pixel={settings.pixel} at={taps_at} width={width * settings.pixel} height={height * settings.pixel} />
{/if}

<div class="chrome" bind:this={chrome} style:opacity={fade ? opacity : 1}>
	<div class="top">
		<button type="button" onclick={() => (show_card = !show_card)}>{show_card ? "Hide controls" : "Show controls"}</button>
		<button type="button" class="toggle" onclick={toggle_pause}><span class:off={!paused}>Play</span><span class:off={paused}>Pause</span></button>
		<button type="button" onclick={step_once} disabled={!paused}>Step</button>
		<button type="button" onclick={() => restart()}>Restart</button>
	</div>

	{#if show_card}
		<section class="card">
			<p class="credit">The shader here is not my work or idea; it is <a href="https://vbuckenham.com/">v buckenham</a>'s amazing <a href="https://v21.io/r_g_b.html">r_g_b.html</a>, remixed here for educational purposes.</p>
			<details class="section" bind:open={open.how}>
				<summary>How it works (slop)</summary>
				<div class="prose">
					<p>Each step, every pixel becomes a weighted sum of 25 samples, the kernel's taps; the Hinton Diagram's squares are their weights, hollow if negative and bronze past 1 either way. Persistence blends the sum with the old value, or below 0 pushes past it. Each channel is then clipped to 0–1, and the seeds are stamped if stamping is on. The weights sum to 1, so flat color stays flat; to keep it so, when a square is dragged or typed in, the middle one takes up the difference.</p>
					<p>“Tap” is a signal-processing term for one place a filter reads a sample and multiplies it by a weight. It comes from FIR filters built as a tapped delay line: a signal runs down a chain of delays, and each tap pulls off a copy and scales it. Here each tap is an offset from the pixel (x and y from −2 to 2, times Spacing) and a weight (its square in the diagram).</p>
					<p>The Frequency Response map estimates what a step multiplies stripes' contrast by, for every stripe width and direction (flat in the middle, finer outward), before clipping: shaded where that's over 1, so they grow, and circled where fastest. A step can also shift stripes; half a cycle swaps bright and dark, and near that (hatched) they strobe.</p>
					<p>Contrast scales each weight's distance from 1/25. Drift scales the kernel's lopsided part, which shifts stripes and can grow them. The mouse moves either only while the kernel is random, so a kernel preset or an edited kernel stays as it was chosen or made.</p>
					<p>Taps are Spacing apart, rounded to whole pixels, so fine stripes can look like wider ones to them, and the map roughly repeats. Jitter gives each pixel its own fixed spacing, blurring the repeats and tending to favor the widest stripes.</p>
					<p>A flat ground stays flat, so something has to break it: Noise, a restart from stripes clicked on the Frequency Response map, paint, or the seeds. By default the seeds are a red, a green and a blue dot in a line through the middle, at 1/6, 1/2 and 5/6 of the window's longer side. With stamping on, each step paints them back over its result, so they stay put and keep feeding what grows around them; with it off, they're only where things start, and change like any other pixel.</p>
					<p>Each step's result is stored at the Bit Depth. At 8 bits every channel is rounded to one of 256 levels, so a change of less than half a level is lost: a blur slows as it spreads, then stops, leaving a soft trace of what it blurred. 16-bit and 32-bit floats round far more finely, so a blur gets much flatter before it stops (at 32, too flat to see), for more memory and time per step.</p>
					<p>Red, green and blue follow the rule separately. On dark gray, the red dot raises red and lowers green and blue, so they start opposite: red against cyan.</p>
					<p>Unless a field, button, menu, link or section title has the focus, Space pauses and plays, Enter steps while paused, Z undoes a change to the kernel and Shift-Z redoes it. On the Hinton Diagram, the arrow keys choose a tap; type a weight and press Enter to set it.</p>
				</div>
			</details>

			<details class="section" bind:open={open.presets}>
				<summary>Presets</summary>
				<div class="choices presets">
					<button type="button" onclick={reset}>r_g_b.html</button>
					{#each SETTINGS_PRESET_NAMES as preset (preset)}
						<button type="button" onclick={() => apply(preset)}>{SETTINGS_PRESET_LABELS[preset]}</button>
					{/each}
				</div>
			</details>

			<form novalidate onsubmit={(e) => e.preventDefault()}>
				<details class="section" bind:open={open.time}>
					<summary>Time</summary>
					<label class="row">
						<span>Speed</span>
						<input type="range" min="0" max={SLIDERS.speed.positions} value={position_of(SLIDERS.speed, settings.speed)} oninput={(e) => slide("speed", e)}
							aria-valuetext={format_speed(settings.speed)} />
						<output>{format_speed(settings.speed)}</output>
					</label>
					<p class="muted">Step {steps}.</p>
				</details>

				<details class="section" bind:open={open.start}>
					<summary>Start</summary>
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
						</div>
					</div>
					<div class="row">
						<span>Bit depth</span>
						<div class="choices">
							{#each BIT_DEPTHS as bit_depth (bit_depth)}
								<label><input type="radio" name="bit_depth" bind:group={settings.bit_depth} value={bit_depth} /> {bit_depth}-bit</label>
							{/each}
						</div>
					</div>
				</details>

				<details class="section" bind:open={open.taps}>
					<summary>Taps</summary>
					<label class="row">
						<span>Spacing</span>
						<input type="range" min="0" max={SLIDERS.spacing.positions} value={position_of(SLIDERS.spacing, settings.spacing)} oninput={(e) => slide("spacing", e)}
							aria-valuetext="{settings.spacing} px" />
						<output>{settings.spacing.toFixed(settings.spacing < 1 ? 2 : 1)} px</output>
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
				</details>

				<details class="section" bind:open={open.kernel}>
					<summary>Kernel</summary>
					<div class="row">
						<span>Kernel</span>
						<div class="wide pick">
							<select value={source.kind === "seed" ? "random" : source.kind === "preset" ? source.name : "edited"} onchange={(e) => choose(e.currentTarget.value)}>
								<option value="random">Random</option>
								{#each PRESET_GROUPS as [label, names] (label)}
									<optgroup label={label}>
										{#each names as name (name)}
											<option value={name}>{PRESET_LABELS[name]}</option>
										{/each}
									</optgroup>
								{/each}
								{#if source.kind === "edited"}
									<option value="edited" disabled>Edited</option>
								{/if}
							</select>
							<button type="button" onclick={new_kernel}>Randomize</button>
						</div>
					</div>
					{#if source.kind === "seed"}
						<div class="row">
							<span>Number</span>
							<div class="seed">
								<button type="button" onclick={() => (remember(), jump((last_seed ?? 0) - 1))} aria-label="Previous kernel">‹</button>
								<input type="number" min="0" max={MAX_SEED} step="1" value={source.seed} onchange={commit_seed} aria-label="Kernel number" />
								<button type="button" onclick={() => (remember(), jump((last_seed ?? 0) + 1))} aria-label="Next kernel">›</button>
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
						<KernelDiagram kernel={shown} group={group} onstart={remember} onedit={take} />
						<GrowthMap model={model} theme={theme.theme} onplant={(fx, fy) => restart({ fx, fy })} ongrow={grow} bind:caption={map_caption} />
					</div>
					<p class="muted map-caption">{map_caption}</p>
					<div class="tools">
						<button type="button" onclick={() => travel(done, undone)} disabled={!can_undo}>Undo</button>
						<button type="button" onclick={() => travel(undone, done)} disabled={!can_redo}>Redo</button>
						<button type="button" onclick={() => transform("turn")} aria-label="Turn a quarter counterclockwise">↺</button>
						<button type="button" onclick={() => transform("mirror")} aria-label="Mirror left to right">⇆</button>
						<button type="button" onclick={() => transform("flip")} aria-label="Mirror top to bottom">⇅</button>
						<button type="button" onclick={() => transform("smooth")}>Smooth</button>
						<button type="button" onclick={() => transform("roughen")}>Roughen</button>
						<button type="button" onclick={mutate}>Mutate</button>
					</div>
					<label class="row">
						<span>Edits change</span>
						<select class="wide" bind:value={group}>
							{#each GROUPS as g (g)}
								<option value={g}>{GROUP_LABELS[g]}</option>
							{/each}
						</select>
					</label>
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
				</details>

				<details class="section" bind:open={open.pointer}>
					<summary>Pointer</summary>
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
					{#if mouse_frozen(settings.mouse_x, "x") || mouse_frozen(settings.mouse_y, "y")}
						<p class="muted">The mouse leaves Contrast and Drift alone while the kernel is a preset or edited.</p>
					{/if}
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
				</details>

				<details class="section" bind:open={open.view}>
					<summary>View</summary>
					{#each VIEW_LINES as line (line[0])}
						<div class="choices">
							{#each line as view (view)}
								<label><input type="radio" name="view" bind:group={settings.view} value={view} /> {VIEW_LABELS[view]}</label>
							{/each}
						</div>
					{/each}
				</details>
			</form>

			<label class="row">
				<span>UI theme</span>
				<select class="wide" value={theme.theme} onchange={(e) => theme.set(parse_theme(e.currentTarget.value))}>
					{#each THEMES as option (option)}
						<option value={option}>{THEME_LABELS[option]}</option>
					{/each}
				</select>
			</label>
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

	/* The corner buttons and the card under them, which fade together as the pointer leaves them.
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

	/* Three lines, whatever the map says, so the controls under it stay put. */
	.map-caption {
		min-height: 3lh;
	}

	.prose {
		font-size: 12px;
		line-height: 1.45;
	}
	.prose p {
		margin: 6px 0;
	}

	.credit {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.muted {
		color: var(--text-muted);
		font-size: 12px;
		margin: 2px 0 4px;
	}

	select {
		padding: 1px 2px;
		background: var(--card);
		border: 1px solid var(--rule-strong);
		border-radius: 0;
	}

	/* Sections fold away under their small uppercase titles. */
	.section {
		border-top: 1px solid var(--rule);
		margin: 6px 0 0;
		padding: 4px 0 2px;
	}
	/* The card's own rows are parts of it, ruled off like the sections. */
	.card > .row {
		border-top: 1px solid var(--rule);
		margin: 6px 0 0;
		padding: 6px 0 2px;
	}
	summary {
		cursor: pointer;
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
	/* When its choices wrap, the label stays with the first line. */
	.row:has(> .choices) {
		align-items: baseline;
	}
	.row output {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		text-align: right;
		white-space: nowrap;
	}

	/* The text gives the baseline; a box's own baseline is its bottom edge, so it's centered instead. */
	.check, .choices label {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		white-space: nowrap;
	}
	.check > input, .choices label > input {
		align-self: center;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
		font-size: 12px;
	}
	/* A line of choices of its own sits as far from the title and its neighbors as a row does,
	   which is as far as a wrapped line. */
	.section > .choices {
		margin: 4px 0;
	}
	input[type="checkbox"], input[type="radio"] {
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
	/* The kernel select, and Randomize beside it. */
	.pick {
		display: flex;
		gap: 6px;
	}
	.pick select {
		flex: 1;
		min-width: 0;
	}

	/* Above the card, and still there when it's hidden. */
	.top {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	/* A button with two labels in one cell, the one not showing hidden but still laid out, so
	   it is as wide as the longer label either way. Centered as a button's label would be. */
	.toggle {
		display: inline-grid;
		align-items: center;
	}
	.toggle > span {
		grid-area: 1 / 1;
	}
	.toggle > .off {
		visibility: hidden;
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 12px 24px;
		margin: 6px 0 0;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 4px 0 6px;
	}
	.tools button, .presets button {
		padding: 0 7px;
		font-size: 12px;
		line-height: 20px;
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
