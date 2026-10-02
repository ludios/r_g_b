// Model-output: Claude Opus 5.5
import { array, assert, constantFrom, double, integer, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { BALANCES, FLAT, GROUPS, Kernels, MAX_SEED, PRESETS, TAPS, TRANSFORMS, gen_kernel, group_of, mutated, next_seed, seeded_kernel, with_contrast, with_delta, with_drift } from "./kernel";

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

describe("TRANSFORMS", () => {
	test("keep the sum; four turns, two mirrors and two flips are no change", () => {
		assert(property(draws, (values) => {
			const kernel = gen_kernel(replay(values));
			for (const transform of Object.values(TRANSFORMS)) {
				expect(sum(transform(kernel))).toBeCloseTo(1, 12);
			}
			const { turn, mirror, flip } = TRANSFORMS;
			expect(turn(turn(turn(turn(kernel))))).toEqual(kernel);
			expect(mirror(mirror(kernel))).toEqual(kernel);
			expect(flip(flip(kernel))).toEqual(kernel);
		}));
	});

	test("turn a shift to the right into one up", () => {
		expect(TRANSFORMS.turn(PRESETS.shift)[17]).toBe(1); // x = 0, y = 1
	});
});

describe("group_of", () => {
	test("is the tap, its mirror pair, or its ring", () => {
		expect(group_of(13, "tap")).toEqual([13]);
		expect(group_of(13, "pair").toSorted((a, b) => a - b)).toEqual([11, 13]);
		expect(group_of(13, "ring")).toHaveLength(4); // (1, 0)
		expect(group_of(19, "ring")).toHaveLength(8); // (2, 1)
		expect(group_of(12, "ring")).toEqual([12]);
	});
});

describe("with_delta", () => {
	test("moves the group's weights and keeps the sum", () => {
		assert(property(draws, integer({ min: 0, max: TAPS - 1 }), double({ min: -1, max: 1, noNaN: true }), constantFrom(...GROUPS), constantFrom(...BALANCES),
			(values, index, delta, group, balance) => {
				const kernel = gen_kernel(replay(values));
				const taps = group_of(index, group);
				const edited = with_delta(kernel, taps, delta, balance);
				for (const i of taps) {
					expect(edited[i]! - kernel[i]!).toBeCloseTo(delta, 12);
				}
				expect(sum(edited)).toBeCloseTo(1, 10);
			}));
	});

	test("keeps a sparse kernel sparse when the middle makes up", () => {
		const edited = with_delta(PRESETS.shift, [13], -0.5, "middle");
		expect(edited.filter((k) => k !== 0)).toEqual([0.5, 0.5]);
	});
});

describe("mutated", () => {
	test("keeps the sum", () => {
		assert(property(draws, (values) => {
			expect(sum(mutated(gen_kernel(replay(values)), 0.05, Math.random))).toBeCloseTo(1, 12);
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
		const edited = with_delta(PRESETS.ring, [0], 0.5, "others");
		kernels.edit(edited);
		kernels.advance(1);
		expect(kernels.kernel).toEqual(edited);
		expect(kernels.source).toEqual({ kind: "edited" });
		kernels.jump(42);
		expect(kernels.kernel).toEqual(seeded_kernel(42));
	});
});
