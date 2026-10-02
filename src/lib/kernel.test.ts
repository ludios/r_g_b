// Model-output: Claude Opus 5.5
import { array, assert, double, integer, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { FLAT, Kernels, MAX_SEED, PRESETS, TAPS, gen_kernel, next_seed, seeded_kernel, with_contrast, with_drift, with_weight } from "./kernel";

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

describe("PRESETS", () => {
	test("sum to 1", () => {
		for (const kernel of Object.values(PRESETS)) {
			expect(kernel).toHaveLength(TAPS);
			expect(sum(kernel)).toBeCloseTo(1, 12);
		}
	});
});

describe("with_drift", () => {
	test("keeps the kernel at 1, turns it half a turn at -1, and keeps the sum", () => {
		assert(property(draws, double({ min: -3, max: 3, noNaN: true }), (values, drift) => {
			const kernel = gen_kernel(replay(values));
			expect(with_drift(kernel, 1).map((k, i) => k - kernel[i]!).every((d) => Math.abs(d) < 1e-12)).toBe(true);
			expect(with_drift(kernel, -1).map((k, i) => k - kernel[TAPS - 1 - i]!).every((d) => Math.abs(d) < 1e-12)).toBe(true);
			expect(sum(with_drift(kernel, drift))).toBeCloseTo(1, 10);
		}));
	});

	test("moves a shift's weight to both sides at 0", () => {
		const symmetric = with_drift(PRESETS.shift, 0);
		expect(symmetric[13]).toBe(0.5); // x = 1, y = 0
		expect(symmetric[11]).toBe(0.5); // x = -1, y = 0
	});
});

describe("with_weight", () => {
	test("sets one weight and keeps the sum", () => {
		assert(property(draws, integer({ min: 0, max: TAPS - 1 }), double({ min: -2, max: 2, noNaN: true }), (values, index, weight) => {
			const edited = with_weight(gen_kernel(replay(values)), index, weight);
			expect(edited[index]).toBe(weight);
			expect(sum(edited)).toBeCloseTo(1, 10);
		}));
	});
});

describe("seeded_kernel", () => {
	test("is the same kernel for the same seed, and another for the next", () => {
		expect(seeded_kernel(4711)).toEqual(seeded_kernel(4711));
		expect(seeded_kernel(4712)).not.toEqual(seeded_kernel(4711));
		expect(next_seed(MAX_SEED)).toBe(0);
	});
});

describe("Kernels", () => {
	test("a random kernel ends at the next seed's after the given steps, and moves on", () => {
		const kernels = new Kernels(MAX_SEED);
		expect(kernels.kernel).toEqual(seeded_kernel(MAX_SEED));
		for (let i = 0; i < 5; i++) {
			kernels.advance(10);
		}
		expect(kernels.progress).toBeCloseTo(0.5, 12);
		expect(sum(kernels.kernel)).toBeCloseTo(1, 12);
		for (let i = 0; i < 5; i++) {
			kernels.advance(10);
		}
		expect(kernels.progress).toBe(0);
		expect(kernels.source).toEqual({ kind: "seed", seed: 0 });
		expect(kernels.kernel).toEqual(seeded_kernel(0));
	});

	test("presets and edited kernels stay put", () => {
		const kernels = new Kernels(1);
		kernels.choose("ring");
		kernels.advance(2);
		kernels.advance(2);
		expect(kernels.kernel).toEqual(PRESETS.ring);
		const edited = with_weight(PRESETS.ring, 0, 0.5);
		kernels.edit(edited);
		kernels.advance(1);
		expect(kernels.kernel).toEqual(edited);
		expect(kernels.source).toEqual({ kind: "edited" });
		kernels.jump(42);
		expect(kernels.kernel).toEqual(seeded_kernel(42));
	});
});
