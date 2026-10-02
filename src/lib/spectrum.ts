// Model-output: Claude Opus 5.5

// What one step does to waves, ignoring the clamp. A pattern of stripes, cos(2 pi f . r) with f in
// cycles per pixel, comes out of a step as |M| cos(2 pi f . r + arg M) for a complex multiplier
// M(f): stripes with |M| > 1 grow, the rest fade, and arg M moves them, or inverts them near half a
// turn. The step is linear but for the clamp, so a pattern is a sum of such stripes, each on its own
// until the clamp catches it.
import { A } from "ayy";
import { type Kernel, TAPS } from "./kernel";

/** The parts of the step that M depends on; see Settings for their meanings. */
export interface StepModel {
	kernel: Kernel;
	spacing: number;
	jitter: number;
	persistence: number;
}

/** A wave: how often its stripes repeat, and what a step does to them. */
export interface Mode {
	/** Cycles per pixel, across and up. */
	fx: number;
	fy: number;
	/** |M|: how much a step multiplies the stripes' contrast by. */
	growth: number;
	/** arg M, in (-pi, pi]: how far a step moves the stripes, in turns of their cycle. */
	phase: number;
}

/** M over the frequencies f within `reach` cycles per pixel of 0 across and up, on a square grid. */
export interface GrowthMap {
	/** The grid has size x size points, from -reach to reach; size is odd, so f = 0 is the middle. */
	size: number;
	reach: number;
	/** Row-major, row 0 at fy = +reach (the top), column 0 at fx = -reach. */
	modes: Mode[];
}

/** sin(x) / x, 1 at 0. */
function sinc(x: number): number {
	return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
}

/**
 * M(f) for a wave with `fx`, `fy` cycles per pixel. Each tap reads the texel at
 * floor(0.5 + spacing * d) pixels away, as sim.frag rounds it; the jitter scales each pixel's
 * spacing by a different amount, which this averages over (as if each tap's scale were uniform
 * and independent), damping the taps' waves more the farther they reach.
 */
export function multiplier(model: StepModel, fx: number, fy: number): Mode {
	A.eq(model.kernel.length, TAPS);
	const { kernel, spacing, jitter, persistence } = model;
	let re = 0;
	let im = 0;
	for (let i = 0; i < TAPS; i++) {
		const dx    = (i % 5) - 2;
		const dy    = Math.floor(i / 5) - 2;
		const along = fx * Math.floor(0.5 + spacing * dx) + fy * Math.floor(0.5 + spacing * dy);
		const damp  = sinc(2 * Math.PI * jitter * spacing * (fx * dx + fy * dy));
		re += kernel[i]! * damp * Math.cos(2 * Math.PI * along);
		im += kernel[i]! * damp * Math.sin(2 * Math.PI * along);
	}
	const p = Math.min(1, Math.max(0, persistence));
	re = p + (1 - p) * re;
	im = (1 - p) * im;
	return { fx, fy, growth: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

/**
 * M around f = 0, far enough to show the taps' aliases: with taps s pixels apart, stripes with f and
 * f + 1/s cycles per pixel land on the taps alike, so without jitter M repeats every 1/s. The map
 * reaches 1.5/s, three repeats across, or the finest stripes pixels can show, if that's nearer.
 * @param size The grid's points across, odd.
 */
export function growth_map(model: StepModel, size: number): GrowthMap {
	A.eq(size % 2, 1);
	const reach = Math.min(0.5, 1.5 / model.spacing);
	const half  = (size - 1) / 2;
	const modes: Mode[] = [];
	for (let row = 0; row < size; row++) {
		for (let column = 0; column < size; column++) {
			modes.push(multiplier(model, ((column - half) / half) * reach, ((half - row) / half) * reach));
		}
	}
	return { size, reach, modes };
}

/**
 * The fastest-growing stripes on the map, other than flat (f = 0, which M always keeps), and of
 * those growing as fast, the widest. Null if nothing grows.
 */
export function fastest(map: GrowthMap): Mode | null {
	const least = (2 * map.reach) / (map.size - 1); // One grid step from f = 0
	let best: Mode | null = null;
	for (const mode of map.modes) {
		const f = Math.hypot(mode.fx, mode.fy);
		if (f < least * 1.5 || mode.growth <= 1 + 1e-9) {
			continue;
		}
		const faster = best === null || mode.growth > best.growth + 1e-9;
		const as_fast_but_wider = best !== null && mode.growth > best.growth - 1e-9 && f < Math.hypot(best.fx, best.fy);
		if (faster || as_fast_but_wider) {
			best = mode;
		}
	}
	return best;
}

/** A mode in pixels: how far apart its stripes are, and how far a step moves them. */
export interface Motion {
	/** Pixels from one stripe to the next. */
	period: number;
	/** Pixels a step moves the stripes, across them, or null if it about inverts them. */
	speed: number | null;
}

/** How a mode looks; within a tenth of half a turn of inverting, it's said to invert. */
export function motion(mode: Mode): Motion {
	const f = Math.hypot(mode.fx, mode.fy);
	A.gt(f, 0);
	const inverts = Math.abs(mode.phase) > 0.9 * Math.PI;
	return { period: 1 / f, speed: inverts ? null : Math.abs(mode.phase) / (2 * Math.PI * f) };
}
