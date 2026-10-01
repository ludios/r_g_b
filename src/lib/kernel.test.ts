// Model-output: Claude Opus 5.5
import { array, assert, double, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { FLAT, KernelDrift, TAPS, gen_kernel, with_contrast } from "./kernel";

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

describe("KernelDrift", () => {
	test("starts at one kernel, ends a minute later at the next, and moves on from there", () => {
		const drift = new KernelDrift(Math.random);
		drift.jump(1000);
		const first = drift.kernel(1000);
		const second = drift.kernel(61_000);
		expect(second).not.toEqual(first);
		expect(sum(drift.kernel(31_000))).toBeCloseTo(1, 12);

		drift.advance(61_000);
		expect(drift.kernel(61_000)).toEqual(second);
		expect(drift.kernel(121_000)).not.toEqual(second);
	});
});
