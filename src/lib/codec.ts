// Model-output: Claude Opus 5.5

// The settings and the kernel as a query string, for the address bar. Only what differs from the
// defaults is written. Reading is forgiving: anything missing or unreadable is the default, and
// numbers past a slider's end are that end.
import { type Kernel, MAX_SEED, PRESETS, type Preset, TAPS } from "./kernel";
import { CLICKS, DEFAULT_SETTINGS, MOUSE_TARGETS, type MouseTarget, BIT_DEPTHS, PIXEL_SIZES, SEEDS, SLIDERS, type Settings, VIEWS } from "./settings";

/** The query string's key for each setting; "k" is a random kernel's seed or a preset, "w" weights. */
const KEYS = {
	contrast:    "c",
	drift:       "d",
	morph:       "m",
	morph_steps: "ms",
	spacing:     "s",
	jitter:      "j",
	persistence: "p",
	speed:       "v",
	seeds:       "sd",
	stamp:       "st",
	ground:      "g",
	noise:       "n",
	pixel:       "px",
	bit_depth:   "bd",
	view:        "vw",
	mouse_x:     "mx",
	mouse_y:     "my",
	click:       "ck",
	brush:       "br",
	paint:       "pc",
} as const satisfies Record<keyof Settings, string>;

/** The most a weight read from a URL may weigh, either way: far past anything the page makes. */
const MOST_WEIGHT = 1000;

/** A kernel as a URL names it: a random one by its seed, a preset, or weights. */
export type KernelName = number | Preset | Kernel;

/** What a URL describes: the settings, and the kernel to start from if it names one. */
export interface Decoded {
	settings: Settings;
	kernel: KernelName | null;
	/** How far a random kernel's crossfade has gone, from 0 up to 1; "kp". */
	progress: number;
}

/**
 * Encodes the settings that differ from the defaults, and the kernel, as `key=value&...`.
 * @param progress How far a random kernel's crossfade has gone, if it's held partway.
 */
export function encode(settings: Settings, kernel: KernelName, progress = 0): string {
	const q = new URLSearchParams();
	if (Array.isArray(kernel)) {
		// Six decimals are plenty; decoding puts the sum back at exactly 1.
		q.set("w", kernel.map((k) => Number(k.toFixed(6))).join(","));
	} else {
		q.set("k", String(kernel));
	}
	if (typeof kernel === "number" && progress > 0) {
		q.set("kp", String(Number(progress.toFixed(6))));
	}
	for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
		const value = settings[key];
		if (value !== DEFAULT_SETTINGS[key]) {
			q.set(KEYS[key], typeof value === "boolean" ? (value ? "1" : "0") : String(value ?? "none"));
		}
	}
	return q.toString();
}

/**
 * Decodes what `encode` produced, or any query string.
 * @param query With or without the leading `?`.
 */
export function decode(query: string): Decoded {
	const q = new URLSearchParams(query);
	const d = DEFAULT_SETTINGS;
	const number = (key: keyof typeof SLIDERS): number => {
		const raw = q.get(KEYS[key]);
		const n   = raw === null || raw === "" ? NaN : Number(raw);
		const { min, max } = SLIDERS[key];
		return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d[key];
	};
	const flag = (key: "morph" | "stamp"): boolean => {
		const raw = q.get(KEYS[key]);
		return raw === "1" ? true : raw === "0" ? false : d[key];
	};
	const target = (key: "mouse_x" | "mouse_y"): MouseTarget | null => {
		const raw = q.get(KEYS[key]);
		return raw === "none" ? null : MOUSE_TARGETS.find((t) => t === raw) ?? d[key];
	};
	const paint = q.get(KEYS.paint);
	/** One of `options`, which are strings or numbers. */
	const choice = <T>(key: keyof Settings, options: readonly T[], fallback: T): T => {
		const raw = q.get(KEYS[key]);
		return options.find((option) => String(option) === raw) ?? fallback;
	};
	return {
		settings: {
			contrast:    number("contrast"),
			drift:       number("drift"),
			morph:       flag("morph"),
			morph_steps: Math.round(number("morph_steps")),
			spacing:     number("spacing"),
			jitter:      number("jitter"),
			persistence: number("persistence"),
			speed:       number("speed"),
			seeds:       choice("seeds", SEEDS, d.seeds),
			stamp:       flag("stamp"),
			ground:      number("ground"),
			noise:       number("noise"),
			pixel:       choice("pixel", PIXEL_SIZES, d.pixel),
			bit_depth:   choice("bit_depth", BIT_DEPTHS, d.bit_depth),
			view:        choice("view", VIEWS, d.view),
			mouse_x:     target("mouse_x"),
			mouse_y:     target("mouse_y"),
			click:       choice("click", CLICKS, d.click),
			brush:       number("brush"),
			paint:       paint !== null && /^#[0-9a-f]{6}$/.test(paint) ? paint : d.paint,
		},
		kernel:   decode_kernel(q),
		progress: decode_progress(q),
	};
}

/** A held crossfade's progress from "kp", from 0 up to 1, or 0. */
function decode_progress(q: URLSearchParams): number {
	const raw = q.get("kp");
	const n   = raw === null || raw === "" ? NaN : Number(raw);
	return n >= 0 && n < 1 ? n : 0;
}

/** The kernel `q` names, if any: weights in "w" win over "k". */
function decode_kernel(q: URLSearchParams): KernelName | null {
	const weights = (q.get("w") ?? "").split(",").map(Number);
	if (weights.length === TAPS && weights.every(Number.isFinite)) {
		// Any sum but 1 brightens or darkens flat areas, step after step.
		const adjustment = (1 - weights.reduce((s, k) => s + k, 0)) / TAPS;
		const kernel = weights.map((k) => k + adjustment);
		// Huge weights can sum past the largest number, or pass float32's in the shader.
		if (kernel.every((k) => Math.abs(k) <= MOST_WEIGHT)) {
			return kernel;
		}
	}
	const k = q.get("k") ?? "";
	if (Object.hasOwn(PRESETS, k)) {
		return k as Preset;
	}
	// Only plain digits, as encode() writes them: Number() would also take "", " 7" and "0x10".
	const seed = /^\d{1,10}$/.test(k) ? Number(k) : NaN;
	return seed <= MAX_SEED ? seed : null;
}
