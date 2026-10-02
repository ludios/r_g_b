// Model-output: Claude Opus 5.5

// The 5x5 kernels the simulation convolves with: random ones, and the crossfade between them.
import { getLogger } from "@logtape/logtape";
import { A } from "ayy";

const log = getLogger(["r_g_b", "kernel"]);

/** Kernels are numbered by the 32-bit seeds of their random draws. */
export const MAX_SEED = 0xffffffff;

/**
 * Row-major 5x5 weights summing to 1. Row 0 is sim.frag's y = -2, the bottom row on screen;
 * column 0 is x = -2, the left.
 */
export type Kernel = number[];

export const TAPS = 25;

/** The weight of every tap of a flat kernel, which blurs evenly. */
export const FLAT = 1 / TAPS;

/** A standard normal deviate, by Box-Muller. */
function random_normal(random: () => number): number {
	const u = 1 - random(); // (0, 1], so the log is finite
	const v = random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Filters the 5x5 weight grid itself with a 3x3 kernel, zero-padded.
 * @param grid Row-major 5x5 weights.
 * @param kernel_3x3 Row-major 3x3 weights.
 * @returns The filtered row-major 5x5 weights.
 */
function convolve_5x5(grid: number[], kernel_3x3: number[]): number[] {
	const at = (x: number, y: number) => (x < 0 || x >= 5 || y < 0 || y >= 5 ? 0 : grid[y * 5 + x]!);
	return grid.map((_, i) => {
		const x = i % 5;
		const y = Math.floor(i / 5);
		let sum = 0;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				sum += at(x + dx, y + dy) * kernel_3x3[(dy + 1) * 3 + (dx + 1)]!;
			}
		}
		return sum;
	});
}

/**
 * A random kernel: flat 1/25 plus N(0, 0.2) noise per weight (so the noise dominates), smoothed
 * by a random mix of identity and 3x3 blur, then shifted to sum to 1. Smoother weights mean
 * wider stripes and slower growth.
 * @param random Uniform on [0, 1), like Math.random.
 */
export function gen_kernel(random: () => number): Kernel {
	const noise = Array.from({ length: TAPS }, () => FLAT + 0.2 * random_normal(random));
	const blur_amount = random();
	const identity = [0, 0, 0, 0, 1, 0, 0, 0, 0];
	const blur = [1, 2, 1, 2, 4, 2, 1, 2, 1].map(b => b / 16);
	const smoothing = blur.map((b, i) => b * blur_amount + identity[i]! * (1 - blur_amount));
	const smoothed = convolve_5x5(noise, smoothing);
	const adjustment = (1 - smoothed.reduce((s, v) => s + v)) / TAPS;
	return smoothed.map(k => k + adjustment);
}

/**
 * A generator of uniform numbers in [0, 1), like Math.random, determined by `seed` (mulberry32).
 * @param seed An integer from 0 to MAX_SEED.
 */
export function seeded_random(seed: number): () => number {
	A.eq(seed >>> 0, seed);
	let s = seed;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The random kernel numbered `seed`. */
export function seeded_kernel(seed: number): Kernel {
	return gen_kernel(seeded_random(seed));
}

/** The seed after `seed`, wrapping around to 0 past MAX_SEED. */
export function next_seed(seed: number): number {
	return (seed + 1) >>> 0;
}

/**
 * Scales each weight's deviation from flat by `gain`, keeping the sum at 1. More deviation
 * amplifies more frequencies, more strongly; at 0 the kernel is flat and the pattern dissolves.
 */
export function with_contrast(kernel: Kernel, gain: number): Kernel {
	return kernel.map(k => (k - FLAT) * gain + FLAT);
}

/** Maps [0, 1] onto [0, 1] along half a cosine, so it starts and ends slowly. */
function ease_in_out_sine(x: number): number {
	return -(Math.cos(Math.PI * x) - 1) / 2;
}

/**
 * The kernel morphing through the random kernels in seed order, one simulation step at a time,
 * so pausing holds it: each crossfades into the next, easing in and out.
 */
export class KernelMorph {
	#seed = 0;
	#from: Kernel = [];
	#to: Kernel = [];
	/** How far the crossfade has gone, from 0 up to 1. */
	#progress = 0;

	/** @param seed The kernel to start from, fading toward the next. */
	constructor(seed: number) {
		this.jump(seed);
	}

	/** The seed of the kernel the crossfade started from; it's fading toward the next seed's. */
	get seed(): number {
		return this.#seed;
	}

	/** How far the crossfade has gone, from 0 up to 1. */
	get progress(): number {
		return this.#progress;
	}

	/** The crossfaded kernel. */
	get kernel(): Kernel {
		const t = ease_in_out_sine(this.#progress);
		return this.#to.map((k, i) => k * t + this.#from[i]! * (1 - t));
	}

	/** Jumps to the kernel numbered `seed`, fading toward the next. */
	jump(seed: number): void {
		this.#seed = seed;
		this.#from = seeded_kernel(seed);
		this.#to = seeded_kernel(next_seed(seed));
		this.#progress = 0;
		log.info("kernel {seed}", { seed });
	}

	/**
	 * Moves the crossfade on by one step; once it's done, the next begins.
	 * @param steps How many steps a whole crossfade takes, at this rate.
	 */
	advance(steps: number): void {
		A.gte(steps, 1);
		this.#progress += 1 / steps;
		// Ten tenths add up to just under 1.
		if (this.#progress > 1 - 1e-9) {
			this.#seed = next_seed(this.#seed);
			this.#from = this.#to;
			this.#to = seeded_kernel(next_seed(this.#seed));
			this.#progress = 0;
			log.info("kernel {seed}", { seed: this.#seed });
		}
	}
}
