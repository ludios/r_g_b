// Model-output: Claude Opus 5.5
import { AssertionError } from "ayy";
import { array, assert, constantFrom, double, integer, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { FLAT, GROUPS, Kernels, MAX_SEED, MIDDLE, PRESETS, TAPS, TRANSFORMS, balanced, gen_kernel, group_of, mutated, neighbor_tap, next_seed, reweighted, seeded_kernel, tap_offset, with_contrast, with_drift } from "./kernel";

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
	});

	test("refuses the middle tap, which follows the others", () => {
		expect(() => group_of(MIDDLE, "tap")).toThrow(AssertionError);
	});
});

describe("neighbor_tap", () => {
	const ARROWS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

	test("goes one tap that way, but over the middle, and stays put at the edge", () => {
		assert(property(integer({ min: 0, max: TAPS - 1 }), constantFrom(...ARROWS), (from, [dx, dy]) => {
			const { x, y } = tap_offset(from);
			const steps = x + dx === 0 && y + dy === 0 ? 2 : 1;
			const next  = { x: x + steps * dx, y: y + steps * dy };
			const edge  = Math.abs(next.x) > 2 || Math.abs(next.y) > 2;
			const to    = neighbor_tap(from, dx, dy);
			expect(to).not.toBe(MIDDLE);
			expect(tap_offset(to)).toEqual(edge ? { x, y } : next);
		}));
	});

	test("reaches every tap but the middle from the middle", () => {
		const reached = new Set([MIDDLE]);
		const queue = [MIDDLE];
		for (let from = queue.pop(); from !== undefined; from = queue.pop()) {
			for (const [dx, dy] of ARROWS) {
				const to = neighbor_tap(from, dx, dy);
				if (!reached.has(to)) {
					reached.add(to);
					queue.push(to);
				}
			}
		}
		expect(reached.size).toBe(TAPS);
	});

	test("refuses to go nowhere", () => {
		expect(() => neighbor_tap(0, 0, 0)).toThrow(AssertionError);
	});
});

describe("balanced", () => {
	test("puts a kernel's sum back at 1 with the middle tap alone", () => {
		const drifted = PRESETS.ring.with(0, 0.9);
		const fixed   = balanced(drifted);
		expect(sum(fixed)).toBeCloseTo(1, 12);
		expect(fixed.toSpliced(MIDDLE, 1)).toEqual(drifted.toSpliced(MIDDLE, 1));
	});
});

describe("reweighted", () => {
	test("moves the group's weights, and only the middle tap makes up for them", () => {
		const others = integer({ min: 0, max: TAPS - 2 }).map((i) => (i < MIDDLE ? i : i + 1));
		assert(property(draws, others, double({ min: -1, max: 1, noNaN: true }), constantFrom(...GROUPS),
			(values, index, delta, group) => {
				const kernel = gen_kernel(replay(values));
				const taps = group_of(index, group);
				const edited = reweighted(kernel, taps, (k) => k + delta);
				const moved  = kernel.map((k, i) => (taps.includes(i) ? k + delta : k));
				expect(edited.toSpliced(MIDDLE, 1)).toEqual(moved.toSpliced(MIDDLE, 1));
				expect(sum(edited)).toBeCloseTo(1, 10);
			}));
	});

	test("keeps a sparse kernel sparse", () => {
		const edited = reweighted(PRESETS.shift, [13], (k) => k - 0.5);
		expect(edited.filter((k) => k !== 0)).toEqual([0.5, 0.5]);
	});

	test("sets a whole ring, whatever its weights were", () => {
		const ring = group_of(13, "ring");
		const edited = reweighted(seeded_kernel(7), ring, () => 0);
		for (const i of ring) {
			expect(edited[i]).toBe(0);
		}
		expect(sum(edited)).toBeCloseTo(1, 12);
	});

	test("refuses to set the middle tap", () => {
		expect(() => reweighted(PRESETS.box, [MIDDLE], () => 0)).toThrow(AssertionError);
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
		const edited = reweighted(PRESETS.ring, [0], (k) => k + 0.5);
		kernels.edit(edited);
		kernels.advance(1);
		expect(kernels.kernel).toEqual(edited);
		expect(kernels.source).toEqual({ kind: "edited" });
		kernels.jump(42);
		expect(kernels.kernel).toEqual(seeded_kernel(42));
	});
});
