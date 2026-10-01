// Model-output: Claude Opus 5.5

// The 5x5 kernels the simulation convolves with: random ones, and the crossfade between them.
import { getLogger } from "@logtape/logtape";
import { A } from "ayy";

const log = getLogger(["r_g_b", "kernel"]);

/**
 * Row-major 5x5 weights summing to 1. Row 0 is sim.frag's y = -2, the bottom row on screen;
 * column 0 is x = -2, the left.
 */
export type Kernel = number[];

export const TAPS = 25;

/** The weight of every tap of a flat kernel, which blurs evenly. */
export const FLAT = 1 / TAPS;

const FADE_MS = 60 * 1000;

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
 * The kernel drifting through random kernels: each crossfades into the next over a minute of
 * real time, which passes while the simulation is paused too.
 */
export class KernelDrift {
	#from: Kernel = [];
	#to: Kernel = [];
	/** When the current crossfade began, in performance.now() milliseconds. */
	#start = 0;

	/** @param random Uniform on [0, 1), like Math.random. */
	constructor(private random: () => number) {}

	/** Jumps to a random kernel, fading toward another. */
	jump(now: number): void {
		this.#fade(this.#generate(), now);
	}

	/** Starts the next crossfade if this one is over; the next starts at the first call after. */
	advance(now: number): void {
		if (now - this.#start >= FADE_MS) {
			this.#fade(this.#to, now);
		}
	}

	/** The crossfaded kernel at `now`. */
	kernel(now: number): Kernel {
		A.eq(this.#from.length, TAPS);
		const t = ease_in_out_sine((now - this.#start) / FADE_MS);
		return this.#to.map((k, i) => k * t + this.#from[i]! * (1 - t));
	}

	#fade(from: Kernel, now: number): void {
		this.#from = from;
		this.#to = this.#generate();
		this.#start = now;
	}

	#generate(): Kernel {
		const kernel = gen_kernel(this.random);
		log.info("new kernel {kernel}", { kernel: JSON.stringify(kernel) });
		return kernel;
	}
}
