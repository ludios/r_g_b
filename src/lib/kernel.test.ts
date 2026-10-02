// Model-output: Claude Opus 5.5
import { array, assert, double, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { FLAT, KernelMorph, MAX_SEED, TAPS, gen_kernel, next_seed, seeded_kernel, with_contrast } from "./kernel";

/** Uniform draws in [0, 1), as many as a kernel takes: two per tap and one for the smoothing. */
const draws = array(double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), { minLength: 2 * TAPS + 1, maxLength: 2 * TAPS + 1 });

/** A `random` function handing out `values` in order. */
function replay(values: number[]): () => number {
	let i = 0;
	return () => {
		const value = values[i++];
		if (value === undefined) {
			throw new Error("ran out of draws");
		}
		return value;
	};
}

function sum(kernel: number[]): number {
	return kernel.reduce((s, k) => s + k, 0);
}

describe("gen_kernel", () => {
	test("makes 25 finite weights summing to 1", () => {
		assert(property(draws, (values) => {
			const kernel = gen_kernel(replay(values));
			expect(kernel).toHaveLength(TAPS);
			expect(kernel.every(Number.isFinite)).toBe(true);
			expect(sum(kernel)).toBeCloseTo(1, 12);
		}));
	});
});

describe("with_contrast", () => {
	test("keeps the sum at 1 and scales deviations from flat", () => {
		assert(property(draws, double({ min: -10, max: 10, noNaN: true }), (values, gain) => {
			const kernel = gen_kernel(replay(values));
			const scaled = with_contrast(kernel, gain);
			expect(sum(scaled)).toBeCloseTo(1, 10);
			scaled.forEach((k, i) => expect(k - FLAT).toBeCloseTo((kernel[i]! - FLAT) * gain, 10));
		}));
	});

	test("at 0 gives a flat kernel", () => {
		expect(with_contrast(gen_kernel(Math.random), 0)).toEqual(Array.from({ length: TAPS }, () => FLAT));
	});
});

describe("seeded_kernel", () => {
	test("is the same kernel for the same seed, and another for the next", () => {
		expect(seeded_kernel(4711)).toEqual(seeded_kernel(4711));
		expect(seeded_kernel(4712)).not.toEqual(seeded_kernel(4711));
		expect(next_seed(MAX_SEED)).toBe(0);
	});
});

describe("KernelMorph", () => {
	test("starts at one seed's kernel, ends at the next seed's after the given steps, and moves on", () => {
		const morph = new KernelMorph(MAX_SEED);
		expect(morph.kernel).toEqual(seeded_kernel(MAX_SEED));
		for (let i = 0; i < 5; i++) {
			morph.advance(10);
		}
		expect(morph.progress).toBeCloseTo(0.5, 12);
		expect(sum(morph.kernel)).toBeCloseTo(1, 12);
		for (let i = 0; i < 5; i++) {
			morph.advance(10);
		}
		expect(morph.progress).toBe(0);
		expect(morph.seed).toBe(0);
		expect(morph.kernel).toEqual(seeded_kernel(0));
		morph.jump(42);
		expect(morph.kernel).toEqual(seeded_kernel(42));
	});
});
