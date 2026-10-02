// Model-output: Claude Opus 5.5
import { assert, double, integer, property } from "fast-check";
import { describe, expect, test } from "vitest";
import { type Kernel, PRESETS, TAPS, TRANSFORMS, gen_kernel, seeded_kernel } from "./kernel";
import { SLIDERS } from "./settings";
import { type StepModel, fastest, growing, growth_map, mode_at, motion, multiplier } from "./spectrum";

/** `n` modulo `m`, in [0, m) even for negative `n`. */
function wrap(n: number, m: number): number {
	return ((n % m) + m) % m;
}

/**
 * One step of sim.frag without the clamp or seeds, on a w x h image that wraps around, with no
 * jitter; image[y][x], y up.
 */
function step(model: StepModel, image: number[][]): number[][] {
	const h = image.length;
	const w = image[0]!.length;
	return image.map((row, y) => row.map((value, x) => {
		let sum = 0;
		for (let i = 0; i < TAPS; i++) {
			const ox = Math.floor(0.5 + model.spacing * ((i % 5) - 2));
			const oy = Math.floor(0.5 + model.spacing * (Math.floor(i / 5) - 2));
			sum += image[wrap(y + oy, h)]![wrap(x + ox, w)]! * model.kernel[i]!;
		}
		return model.persistence * value + (1 - model.persistence) * sum;
	}));
}

/** A step of `kernel` with taps 1 pixel apart, and no jitter or persistence. */
function unit(kernel: Kernel): StepModel {
	return { kernel, spacing: 1, jitter: 0, persistence: 0 };
}

/**
 * The most a step of unit(kernel) grows stripes whose waves run `degrees` counterclockwise from
 * across, of any width pixels can show: out to half a cycle per pixel across or up.
 */
function fastest_along(kernel: Kernel, degrees: number): number {
	const angle = (degrees * Math.PI) / 180;
	const reach = 0.5 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
	let most = 0;
	for (let i = 1; i <= 500; i++) {
		const f = (i / 500) * reach;
		most = Math.max(most, multiplier(unit(kernel), f * Math.cos(angle), f * Math.sin(angle)).growth);
	}
	return most;
}

describe("multiplier", () => {
	test("is what one step does to a wave that fits the image", () => {
		const n = 48;
		assert(property(integer({ min: 0, max: 1000 }), integer({ min: -6, max: 6 }), integer({ min: -6, max: 6 }),
			double({ min: 1, max: 9, noNaN: true }), double({ min: -1, max: 1, noNaN: true }), (seed, kx, ky, spacing, persistence) => {
				const model: StepModel = { kernel: seeded_kernel(seed), spacing, jitter: 0, persistence };
				const fx = kx / n;
				const fy = ky / n;
				const wave = Array.from({ length: n }, (_row, y) => Array.from({ length: n }, (_column, x) => Math.cos(2 * Math.PI * (fx * x + fy * y))));
				const { growth, phase } = multiplier(model, fx, fy);
				const stepped = step(model, wave);
				for (const [x, y] of [[0, 0], [5, 17], [31, 40]] as const) {
					expect(stepped[y]![x]!).toBeCloseTo(growth * Math.cos(2 * Math.PI * (fx * x + fy * y) + phase), 9);
				}
			}));
	});

	test("keeps flat areas flat, and pairs each wave with its mirror image", () => {
		assert(property(integer({ min: 0, max: 1000 }), double({ min: -0.5, max: 0.5, noNaN: true }), double({ min: -0.5, max: 0.5, noNaN: true }), (seed, fx, fy) => {
			const model: StepModel = { kernel: seeded_kernel(seed), spacing: 7.3, jitter: 0.05, persistence: 0.2 };
			expect(multiplier(model, 0, 0).growth).toBeCloseTo(1, 12);
			// M(-f) is the complex conjugate of M(f).
			const a = multiplier(model, fx, fy);
			const b = multiplier(model, -fx, -fy);
			expect(b.growth * Math.cos(b.phase)).toBeCloseTo(a.growth * Math.cos(a.phase), 12);
			expect(b.growth * Math.sin(b.phase)).toBeCloseTo(-a.growth * Math.sin(a.phase), 12);
		}));
	});

	test("is 1 everywhere for the identity and at full persistence", () => {
		const kernel = gen_kernel(Math.random);
		expect(multiplier({ kernel: PRESETS.identity, spacing: 5, jitter: 0.1, persistence: 0 }, 0.13, -0.31).growth).toBeCloseTo(1, 12);
		expect(multiplier({ kernel, spacing: 5, jitter: 0.1, persistence: 1 }, 0.13, -0.31).growth).toBeCloseTo(1, 12);
	});
});

describe("growth_map", () => {
	test("is the multiplier at each point", () => {
		assert(property(integer({ min: 0, max: 1000 }), double({ min: 1, max: 50, noNaN: true }), double({ min: 0, max: 0.25, noNaN: true }),
			double({ min: -1, max: 1, noNaN: true }), integer({ min: 0, max: 21 * 21 - 1 }), (seed, spacing, jitter, persistence, index) => {
				const model: StepModel = { kernel: seeded_kernel(seed), spacing, jitter, persistence };
				const mode = mode_at(growth_map(model, 21), index);
				const exact = multiplier(model, mode.fx, mode.fy);
				expect(mode.growth).toBeCloseTo(exact.growth, 9);
				expect(Math.cos(mode.phase) * mode.growth).toBeCloseTo(Math.cos(exact.phase) * exact.growth, 9);
				expect(Math.sin(mode.phase) * mode.growth).toBeCloseTo(Math.sin(exact.phase) * exact.growth, 9);
			}));
	});
});

describe("growing", () => {
	test("grows the wave it's made for as much as asked, through jitter and persistence", () => {
		const taps = { spacing: 8, jitter: 0.05, persistence: 0.5 };
		const kernel = growing(0.03, -0.02, taps, 1.5)!;
		expect(kernel.reduce((s, k) => s + k, 0)).toBeCloseTo(1, 12);
		expect(multiplier({ ...taps, kernel }, 0.03, -0.02).growth).toBeCloseTo(1.5, 9);
		expect(multiplier({ ...taps, kernel }, 0.03, -0.02).phase).toBeCloseTo(0, 9);
	});

	test("grows wide stripes a small kernel can, and not what the taps see as flat", () => {
		const taps = { spacing: 10, jitter: 0.05, persistence: 0 };
		expect(growing(0.005, 0, taps, 1.5)).not.toBeNull(); // 200 px apart
		expect(growing(0.1, 0, taps, 1.5)).toBeNull(); // A copy of flat: whole cycles at every tap
		expect(growing((0.15 / 87) * 58, 0, taps, 1.5)).toBeNull(); // The same, as the map works it out
		expect(growing(0.03, 0, { ...taps, persistence: 1 }, 1.5)).toBeNull(); // Nothing changes
	});

	test("keeps its weights at 3 or less", () => {
		const { min, max } = SLIDERS.spacing;
		assert(property(double({ min: -0.5, max: 0.5, noNaN: true }), double({ min: -0.5, max: 0.5, noNaN: true }), double({ min, max, noNaN: true }),
			double({ min: -1, max: 1, noNaN: true }), (fx, fy, spacing, persistence) => {
				const kernel = growing(fx, fy, { spacing, jitter: 0.05, persistence }, 1.5);
				expect(kernel === null || kernel.every((k) => Math.abs(k) <= 3)).toBe(true);
			}));
	});
});

describe("motion", () => {
	test("a shift moves every wave one tap a step", () => {
		const map = growth_map({ kernel: PRESETS.shift, spacing: 10, jitter: 0, persistence: 0 }, 21);
		const modes = Array.from(map.growth, (_, i) => mode_at(map, i));
		for (const mode of modes) {
			expect(mode.growth).toBeCloseTo(1, 12);
		}
		// 10 px along x is 10 fx cycles of the wave, or as much less as a whole number of cycles
		// makes it: a move of a whole cycle looks like none. Near half a cycle it inverts.
		const moving = modes
			.map((mode) => ({ mode, cycles: Math.abs(10 * mode.fx - Math.round(10 * mode.fx)) }))
			.filter(({ mode, cycles }) => Math.hypot(mode.fx, mode.fy) > 0 && cycles < 0.45);
		expect(moving.length).toBeGreaterThan(100);
		for (const { mode, cycles } of moving) {
			expect(motion(mode).speed).toBeCloseTo(cycles / Math.hypot(mode.fx, mode.fy), 9);
		}
		expect(fastest(map)).toBeNull();
	});

	test("the checkerboard's fastest stripes are 2 taps apart and invert", () => {
		const map = growth_map({ kernel: PRESETS.checker, spacing: 10, jitter: 0, persistence: 0 }, 31);
		const mode = fastest(map)!;
		expect(mode.growth).toBeCloseTo(2, 9);
		expect(motion(mode).period).toBeCloseTo(20 / Math.SQRT2, 9);
		expect(motion(mode).speed).toBeNull();
	});

	test("persistence turns the checkerboard's inverting growth into decay", () => {
		const map = growth_map({ kernel: PRESETS.checker, spacing: 10, jitter: 0, persistence: 0.5 }, 31);
		expect(fastest(map)).toBeNull();
	});
});

describe("presets", () => {
	test("the ring grows upright and level stripes fastest; the circles grow them alike at any angle", () => {
		const ring = fastest(growth_map(unit(PRESETS.ring), 101))!;
		expect(Math.min(Math.abs(ring.fx), Math.abs(ring.fy))).toBe(0);
		expect(fastest_along(PRESETS.ring, 0)).toBeGreaterThan(1.15 * fastest_along(PRESETS.ring, 45));
		const level = fastest_along(PRESETS.circles, 0);
		expect(level).toBeGreaterThan(2);
		for (let degrees = 5; degrees <= 45; degrees += 5) {
			expect(Math.abs(fastest_along(PRESETS.circles, degrees) / level - 1)).toBeLessThan(0.01);
		}
	});

	test("the hexagons grow stripes fastest in three directions about 60 degrees apart", () => {
		// Across, and 56 degrees either side of it, all six taps land a third of a cycle along the
		// wave either way, at -1/2: as low as they can all be at once, so nothing grows faster.
		for (const [fx, fy] of [[1 / 3, 0], [1 / 6, 1 / 4], [-1 / 6, 1 / 4]] as const) {
			expect(multiplier(unit(PRESETS.hexagons), fx, fy).growth).toBeCloseTo(1.45, 12);
		}
		expect(fastest(growth_map(unit(PRESETS.hexagons), 101))!.growth).toBeLessThan(1.45 + 1e-9);
		for (const degrees of [28, 90, 152]) {
			expect(fastest_along(PRESETS.hexagons, degrees)).toBeLessThan(1.41);
		}
	});

	test("rise grows stripes as the row does, whatever their slant, and moves everything up a tap a step", () => {
		for (const fy of [-0.3, 0, 0.1, 0.25]) {
			expect(multiplier(unit(PRESETS.rise), 1 / 6, fy).growth).toBeCloseTo(1.25, 12);
			// cos(2 pi fy y - 2 pi fy) is the level stripes cos(2 pi fy y) a tap higher.
			expect(multiplier(unit(PRESETS.rise), 0, fy).phase).toBeCloseTo(-2 * Math.PI * fy, 12);
		}
	});

	test("the pinwheel grows stripes fastest about 21 degrees counterclockwise of level, and mirrored, clockwise", () => {
		const turned = [0, 10, 21, 30, 45].map((degrees) => fastest_along(PRESETS.pinwheel, degrees));
		expect(Math.max(...turned)).toBe(turned[2]);
		expect(fastest_along(PRESETS.pinwheel, -21)).toBeLessThan(turned[0]!);
		expect(fastest_along(TRANSFORMS.mirror(PRESETS.pinwheel), -21)).toBeCloseTo(turned[2]!, 9);
	});

	test("emboss grows stripes running up and right 7 times a step as they slide up and left", () => {
		expect(fastest_along(PRESETS.emboss, 135)).toBeGreaterThan(7);
		expect(fastest_along(PRESETS.emboss, 45)).toBeCloseTo(1, 12);
		// Waves running up and left come out of a step behind where they were: moved along.
		expect(multiplier(unit(PRESETS.emboss), -0.15, 0.15).phase).toBeLessThan(0);
	});
});
