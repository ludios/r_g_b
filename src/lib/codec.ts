// Model-output: Claude Opus 5.5

// The settings and the kernel's seed as a query string, for the address bar. Only what differs
// from the defaults is written. Reading is forgiving: anything missing or unreadable is the
// default, and numbers past a slider's end are that end.
import { MAX_SEED } from "./kernel";
import { DEFAULT_SETTINGS, PARAMS, type Param, SLIDERS, type Settings } from "./settings";

/** The query string's key for each setting; "k" is the seed. */
const KEYS = {
	contrast:    "c",
	morph:       "m",
	morph_steps: "ms",
	spacing:     "s",
	jitter:      "j",
	persistence: "p",
	speed:       "v",
	ground:      "g",
	mouse_x:     "mx",
	mouse_y:     "my",
} as const satisfies Record<keyof Settings, string>;

/** What a URL describes: the settings, and the kernel to start from if it names one. */
export interface Decoded {
	settings: Settings;
	seed: number | null;
}

/** Encodes the settings that differ from the defaults, and the seed, as `key=value&...`. */
export function encode(settings: Settings, seed: number): string {
	const q = new URLSearchParams({ k: String(seed) });
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
	const flag = (key: "morph"): boolean => {
		const raw = q.get(KEYS[key]);
		return raw === "1" ? true : raw === "0" ? false : d[key];
	};
	const param = (key: "mouse_x" | "mouse_y"): Param | null => {
		const raw = q.get(KEYS[key]);
		return raw === "none" ? null : PARAMS.find((p) => p === raw) ?? d[key];
	};
	const seed = Number(q.get("k") ?? NaN);
	return {
		settings: {
			contrast:    number("contrast"),
			morph:       flag("morph"),
			morph_steps: Math.round(number("morph_steps")),
			spacing:     number("spacing"),
			jitter:      number("jitter"),
			persistence: number("persistence"),
			speed:       number("speed"),
			ground:      number("ground"),
			mouse_x:     param("mouse_x"),
			mouse_y:     param("mouse_y"),
		},
		seed: Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED ? seed : null,
	};
}
