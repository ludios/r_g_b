// Model-output: Claude Opus 5.5

// What the controls set, and how a slider's position maps to a value.
import { A } from "ayy";

/** The settings a slider controls that the mouse can be given too. */
export type Param = "contrast" | "drift" | "spacing" | "jitter" | "persistence";

export const PARAMS: readonly Param[] = ["contrast", "drift", "spacing", "jitter", "persistence"];

/**
 * What the mouse can be given: a slider; spacing and persistence together, as r_g_b.html's mouse Y
 * set them, both exponential in the pointer's place (0 at the top or left, 1/32 of the way in the
 * middle, all the way at the far end, where persistence 1 freezes the image); or whatever
 * r_g_b.html gave that axis, which on X was contrast from 0.8 to 3.8.
 */
export type MouseTarget = Param | "spacing_persistence" | "r_g_b";

export const MOUSE_TARGETS: readonly MouseTarget[] = [...PARAMS, "spacing_persistence", "r_g_b"];

/** What a click or tap on the image does; painting and erasing also drag. */
export const CLICKS = ["kernel", "paint", "erase", "taps"] as const;
export type Click = (typeof CLICKS)[number];

/**
 * Ways to show a frame: in color; one channel alone, in gray; how much each channel changed in
 * the last step; or which channels the clamp changed in the last step.
 */
export const VIEWS = ["color", "red", "green", "blue", "change", "clipped"] as const;
export type View = (typeof VIEWS)[number];

/**
 * What a restart stamps on the ground: the three R, G, B dots; one white dot, which grows the same
 * in every channel; one white pixel; or nothing.
 */
export const SEEDS = ["rgb", "white", "pixel", "none"] as const;
export type Seeds = (typeof SEEDS)[number];

/** How many screen pixels one pixel of the simulation covers, across and down. */
export const PIXEL_SIZES = [1, 2, 4, 8] as const;

/**
 * Bits per channel of the buffers: bytes, which round each step to 1/255, or half or whole floats.
 * A step's change smaller than half a rounding is lost, so a blur stops before it's flat, and the
 * finer the rounding, the flatter it gets first.
 */
export const BIT_DEPTHS = [8, 16, 32] as const;
export type BitDepth = (typeof BIT_DEPTHS)[number];

export interface Settings {
	/** Scales each kernel weight's deviation from flat; 1 is the kernel as generated. */
	contrast: number;
	/** Scales the kernel's lopsided part, which moves the stripes; 1 is the kernel as it is. */
	drift: number;
	/** Whether the kernel crossfades into a new one, over `morph_steps` steps each. */
	morph: boolean;
	morph_steps: number;
	/** The distance between neighboring taps, in pixels of the simulation. */
	spacing: number;
	/** How far each pixel's tap spacing is scaled from 1, at most: 0.05 is +/-5%. */
	jitter: number;
	/**
	 * How much of the previous frame each step keeps, -1 to 1. Below 0 the step goes past the
	 * kernel's result, away from the previous frame: more of what the kernel does.
	 */
	persistence: number;
	/** Steps per display frame: a power of two, from 1/32 to 8. */
	speed: number;
	/** What a restart stamps on the ground, and whether each step stamps it again. */
	seeds: Seeds;
	stamp: boolean;
	/** The gray that a restart fills the buffers with, 0 to 1. */
	ground: number;
	/** How far each channel of each pixel starts from the ground, at most. */
	noise: number;
	/** One of PIXEL_SIZES. */
	pixel: number;
	/** One of BIT_DEPTHS: bits per channel of the buffers. */
	bit_depth: BitDepth;
	/** How the canvas shows each frame. */
	view: View;
	/** What follows the pointer across the window, or nothing. */
	mouse_x: MouseTarget | null;
	mouse_y: MouseTarget | null;
	click: Click;
	/** The paint brush's radius, in pixels of the simulation, and its color as "#rrggbb". */
	brush: number;
	paint: string;
}

/** Settings that play like r_g_b.html: the mouse sets contrast, spacing and persistence as it did. */
export const DEFAULT_SETTINGS: Settings = {
	contrast:    2.3,
	drift:       1,
	morph:       true,
	morph_steps: 3600,
	spacing:     10,
	jitter:      0.05,
	persistence: 0,
	speed:       1,
	seeds:       "rgb",
	stamp:       true,
	ground:      0.05,
	noise:       0,
	pixel:       1,
	bit_depth:   8,
	view:        "color",
	mouse_x:     "r_g_b",
	mouse_y:     "r_g_b",
	click:       "kernel",
	brush:       6,
	paint:       "#ffffff",
};

/** Changes to make to the settings, leaving the rest as they are, by name. */
export const SETTINGS_PRESETS = {
	/** The mouse lets go, so what it set stays put. */
	still: { mouse_x: null, mouse_y: null },
	/** Restarts from noise everywhere, so the kernel's stripes grow all over at once. */
	noise: { seeds: "none", noise: 0.05 },
	/** Restarts from one white dot, which grows the same in every channel: black and white. */
	gray:  { seeds: "white", noise: 0 },
	/** Restarts from a blank ground, and clicks and drags paint on it; the mouse lets go. */
	paint: { seeds: "none", noise: 0, click: "paint", mouse_x: null, mouse_y: null },
} as const satisfies Record<string, Partial<Settings>>;

export type SettingsPreset = keyof typeof SETTINGS_PRESETS;

/** A slider: `positions` steps from `min` to `max`, evenly spaced or spaced by a constant ratio. */
export interface Slider {
	min: number;
	max: number;
	scale: "linear" | "log";
	/** The input's max; its min is 0 and its step 1. */
	positions: number;
	/** Whether values are whole numbers. */
	integer?: boolean;
}

export const SLIDERS = {
	contrast:    { min: 0,      max: 4,     scale: "linear", positions: 200 },
	drift:       { min: -2,     max: 2,     scale: "linear", positions: 200 },
	morph_steps: { min: 60,     max: 36000, scale: "log",    positions: 120, integer: true },
	// Below 0.25, every tap rounds to the pixel itself; at 0.25 exactly, +2 and -2 round unevenly.
	spacing:     { min: 0.2,    max: 256,   scale: "log",    positions: 240 },
	jitter:      { min: 0,      max: 0.25,  scale: "linear", positions: 100 },
	persistence: { min: -1,     max: 1,     scale: "linear", positions: 400 },
	speed:       { min: 1 / 32, max: 8,     scale: "log",    positions: 8 },
	ground:      { min: 0,      max: 1,     scale: "linear", positions: 255 },
	noise:       { min: 0,      max: 0.5,   scale: "linear", positions: 100 },
	brush:       { min: 0.5,    max: 64,    scale: "log",    positions: 70 },
} as const satisfies Record<string, Slider>;

/**
 * The value at a slider position, whole or to four significant digits, so that it reads back
 * as shown.
 * @param position 0 to `s.positions`; anything past an end is that end.
 */
export function value_at(s: Slider, position: number): number {
	A.lt(s.min, s.max);
	const t = Math.min(1, Math.max(0, position / s.positions));
	const value = s.scale === "linear" ? s.min + t * (s.max - s.min) : s.min * Math.pow(s.max / s.min, t);
	return s.integer ? Math.round(value) : Number(value.toPrecision(4));
}

/** The nearest slider position to `value`; anything past an end sits at that end. */
export function position_of(s: Slider, value: number): number {
	A.lt(s.min, s.max);
	const clamped = Math.min(s.max, Math.max(s.min, value));
	const t = s.scale === "linear" ? (clamped - s.min) / (s.max - s.min) : Math.log(clamped / s.min) / Math.log(s.max / s.min);
	return Math.round(t * s.positions);
}
