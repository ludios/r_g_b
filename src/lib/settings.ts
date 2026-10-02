// Model-output: Claude Opus 5.5

// What the controls set, and how a slider's position maps to a value.
import { A } from "ayy";

/** The settings a slider controls that the mouse can be given too. */
export type Param = "contrast" | "spacing" | "jitter" | "persistence";

export const PARAMS: readonly Param[] = ["contrast", "spacing", "jitter", "persistence"];

export interface Settings {
	/** Scales each kernel weight's deviation from flat; 1 is the kernel as generated. */
	contrast: number;
	/** Whether the kernel crossfades into a new one, over `morph_steps` steps each. */
	morph: boolean;
	morph_steps: number;
	/** The distance between neighboring taps, in pixels of the simulation. */
	spacing: number;
	/** How far each pixel's tap spacing is scaled from 1, at most: 0.05 is +/-5%. */
	jitter: number;
	/** How much of the previous frame each step keeps, 0 to 1. */
	persistence: number;
	/** Steps per display frame: a power of two, from 1/32 to 8. */
	speed: number;
	/** The gray that a restart fills the buffers with, 0 to 1. */
	ground: number;
	/** The setting that follows the pointer across the window, or none. */
	mouse_x: Param | null;
	mouse_y: Param | null;
}

export const DEFAULT_SETTINGS: Settings = {
	contrast:    2.3,
	morph:       true,
	morph_steps: 3600,
	spacing:     10,
	jitter:      0.05,
	persistence: 0,
	speed:       1,
	ground:      0.05,
	mouse_x:     null,
	mouse_y:     null,
};

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
	morph_steps: { min: 60,     max: 36000, scale: "log",    positions: 120, integer: true },
	spacing:     { min: 1,      max: 256,   scale: "log",    positions: 240 },
	jitter:      { min: 0,      max: 0.25,  scale: "linear", positions: 100 },
	persistence: { min: 0,      max: 1,     scale: "linear", positions: 400 },
	speed:       { min: 1 / 32, max: 8,     scale: "log",    positions: 8 },
	ground:      { min: 0,      max: 1,     scale: "linear", positions: 255 },
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
