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
	/** |M| and arg M at each point, row-major, row 0 at fy = +reach (the top), column 0 at fx = -reach. */
	growth: Float64Array;
	phase: Float64Array;
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
	const p = Math.min(1, Math.max(-1, persistence));
	re = p + (1 - p) * re;
	im = (1 - p) * im;
	return { fx, fy, growth: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

/**
 * M around f = 0, far enough to show the taps' aliases: with taps s pixels apart, stripes with f and
 * f + 1/s cycles per pixel land on the taps alike, so without jitter M repeats every 1/s. The map
 * reaches 1.5/s, three repeats across, or the finest stripes pixels can show, if that's nearer.
 * It's what `multiplier` gives at each point, but from tables, since it's 25 taps at each of
 * size^2 points, several times a second while the kernel morphs.
 * @param size The grid's points across, odd.
 */
export function growth_map(model: StepModel, size: number): GrowthMap {
	A.eq(size % 2, 1);
	A.eq(model.kernel.length, TAPS);
	const { kernel, spacing, jitter } = model;
	const reach = Math.min(0.5, 1.5 / spacing);
	const half  = (size - 1) / 2;
	const step  = reach / half; // Cycles per pixel from one point to the next
	const p     = Math.min(1, Math.max(-1, model.persistence));

	// The phase each tap's offset gives a wave, per axis: at column or row k (from -half to half)
	// and tap d (from -2 to 2), 2 pi k step floor(0.5 + spacing d).
	const cos = new Float64Array(size * 5);
	const sin = new Float64Array(size * 5);
	for (let k = -half; k <= half; k++) {
		for (let d = -2; d <= 2; d++) {
			const angle = 2 * Math.PI * k * step * Math.floor(0.5 + spacing * d);
			cos[(k + half) * 5 + d + 2] = Math.cos(angle);
			sin[(k + half) * 5 + d + 2] = Math.sin(angle);
		}
	}
	// The jitter's damping depends on f . d, which is step times a whole number from -4 half to
	// 4 half.
	const damp = new Float64Array(8 * half + 1);
	for (let n = -4 * half; n <= 4 * half; n++) {
		damp[n + 4 * half] = sinc(2 * Math.PI * jitter * spacing * step * n);
	}

	const growth = new Float64Array(size * size);
	const phase  = new Float64Array(size * size);
	for (let row = 0; row < size; row++) {
		const ky = half - row;
		for (let column = 0; column < size; column++) {
			const kx = column - half;
			let re = 0;
			let im = 0;
			for (let dy = -2; dy <= 2; dy++) {
				const cy = cos[(ky + half) * 5 + dy + 2]!;
				const sy = sin[(ky + half) * 5 + dy + 2]!;
				for (let dx = -2; dx <= 2; dx++) {
					const w  = kernel[(dy + 2) * 5 + dx + 2]! * damp[kx * dx + ky * dy + 4 * half]!;
					const cx = cos[(kx + half) * 5 + dx + 2]!;
					const sx = sin[(kx + half) * 5 + dx + 2]!;
					re += w * (cx * cy - sx * sy);
					im += w * (sx * cy + cx * sy);
				}
			}
			const i = row * size + column;
			re = p + (1 - p) * re;
			im = (1 - p) * im;
			growth[i] = Math.hypot(re, im);
			phase[i]  = Math.atan2(im, re);
		}
	}
	return { size, reach, growth, phase };
}

/** The map's point `index` as a mode. */
export function mode_at(map: GrowthMap, index: number): Mode {
	const half = (map.size - 1) / 2;
	const step = map.reach / half;
	return {
		fx:     ((index % map.size) - half) * step,
		fy:     (half - Math.floor(index / map.size)) * step,
		growth: map.growth[index]!,
		phase:  map.phase[index]!,
	};
}

/**
 * The fastest-growing stripes on the map, other than flat (f = 0, which M always keeps), and of
 * those growing as fast, the widest. Null if nothing grows.
 */
export function fastest(map: GrowthMap): Mode | null {
	const half = (map.size - 1) / 2;
	let best: number | null = null;
	let best_f = 0;
	for (let i = 0; i < map.growth.length; i++) {
		const g = map.growth[i]!;
		// In grid steps from the middle; the points next to it are too near flat to count.
		const f = Math.hypot((i % map.size) - half, half - Math.floor(i / map.size));
		if (f < 1.5 || g <= 1 + 1e-9) {
			continue;
		}
		const faster = best === null || g > map.growth[best]! + 1e-9;
		const as_fast_but_wider = best !== null && g > map.growth[best]! - 1e-9 && f < best_f;
		if (faster || as_fast_but_wider) {
			best = i;
			best_f = f;
		}
	}
	return best === null ? null : mode_at(map, best);
}

/** A mode in pixels: how far apart its stripes are, and how far a step moves them. */
export interface Motion {
	/** Pixels from one stripe to the next. */
	period: number;
	/** Pixels a step moves the stripes, across them, or null if it about inverts them. */
	speed: number | null;
}

/** Whether a step about inverts stripes: shifts them more than 0.45 of a cycle (half inverts them). */
export function inverts(phase: number): boolean {
	return Math.abs(phase) > 0.9 * Math.PI;
}

/** How a mode looks. */
export function motion(mode: Mode): Motion {
	const f = Math.hypot(mode.fx, mode.fy);
	A.gt(f, 0);
	return { period: 1 / f, speed: inverts(mode.phase) ? null : Math.abs(mode.phase) / (2 * Math.PI * f) };
}
