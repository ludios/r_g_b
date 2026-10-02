// Model-output: Claude Opus 5.5
import { assert, boolean, constantFrom, double, integer, property, record, stringMatching } from "fast-check";
import { describe, expect, test } from "vitest";
import { decode, encode } from "./codec";
import { MAX_SEED, PRESETS, with_delta } from "./kernel";
import { CLICKS, DEFAULT_SETTINGS, MOUSE_TARGETS, PIXEL_SIZES, PRECISIONS, SEEDS, SLIDERS, VIEWS } from "./settings";

// Adding 0 makes -0 a plain 0, which is what the URL can say.
const slider = (key: keyof typeof SLIDERS) => double({ min: SLIDERS[key].min, max: SLIDERS[key].max, noNaN: true }).map((v) => v + 0);
const settings = record({
	contrast:    slider("contrast"),
	drift:       slider("drift"),
	morph:       boolean(),
	morph_steps: integer({ min: SLIDERS.morph_steps.min, max: SLIDERS.morph_steps.max }),
	spacing:     slider("spacing"),
	jitter:      slider("jitter"),
	persistence: slider("persistence"),
	speed:       slider("speed"),
	seeds:       constantFrom(...SEEDS),
	stamp:       boolean(),
	ground:      slider("ground"),
	noise:       slider("noise"),
	pixel:       constantFrom(...PIXEL_SIZES),
	precision:   constantFrom(...PRECISIONS),
	view:        constantFrom(...VIEWS),
	mouse_x:     constantFrom(null, ...MOUSE_TARGETS),
	mouse_y:     constantFrom(null, ...MOUSE_TARGETS),
	click:       constantFrom(...CLICKS),
	brush:       slider("brush"),
	paint:       stringMatching(/^#[0-9a-f]{6}$/),
});

describe("codec", () => {
	test("decodes what it encodes", () => {
		assert(property(settings, integer({ min: 0, max: MAX_SEED }), (s, seed) => {
			expect(decode(encode(s, seed))).toEqual({ settings: s, kernel: seed, progress: 0 });
		}));
	});

	test("reads back presets, and weights with the sum put back at 1", () => {
		expect(decode(encode(DEFAULT_SETTINGS, "ring")).kernel).toBe("ring");
		const weights = with_delta(PRESETS.ring, [3], 1 / 3, "others");
		const decoded = decode(encode(DEFAULT_SETTINGS, weights)).kernel as number[];
		decoded.forEach((k, i) => expect(k).toBeCloseTo(weights[i]!, 5));
		expect(decoded.reduce((s, k) => s + k, 0)).toBeCloseTo(1, 14);
		expect(decode("w=1,2,3&k=5").kernel).toBe(5);
		expect(decode(`w=${Array.from({ length: 25 }, () => "1e308").join(",")}&k=6`).kernel).toBe(6);
		expect(decode(`w=1e39,-1e39,${Array.from({ length: 23 }, () => "0").join(",")}&k=6`).kernel).toBe(6);
	});

	test("keeps a held crossfade's progress with its seed", () => {
		expect(decode(encode(DEFAULT_SETTINGS, 9, 0.42))).toMatchObject({ kernel: 9, progress: 0.42 });
		expect(encode(DEFAULT_SETTINGS, "ring", 0.42)).toBe("k=ring");
		expect(decode("k=9&kp=1").progress).toBe(0);
		expect(decode("k=9&kp=-0.5").progress).toBe(0);
	});

	test("writes only the seed for the defaults", () => {
		expect(encode(DEFAULT_SETTINGS, 7)).toBe("k=7");
	});

	test("names a kernel only by a preset's own name or plain digits", () => {
		for (const k of ["toString", "constructor", "__proto__", "", " 7", "0x10", "1e3", "4294967296"]) {
			expect(decode(`k=${encodeURIComponent(k)}`).kernel).toBeNull();
		}
		expect(decode("k=4294967295").kernel).toBe(MAX_SEED);
	});

	test("reads junk as the defaults, and numbers past an end as that end", () => {
		expect(decode("?k=-1&c=pony&mx=everything&m=yes")).toEqual({ settings: DEFAULT_SETTINGS, kernel: null, progress: 0 });
		expect(decode("").settings).toEqual(DEFAULT_SETTINGS);
		expect(decode("s=9999&p=-3&k=1.5")).toEqual({ settings: { ...DEFAULT_SETTINGS, spacing: SLIDERS.spacing.max, persistence: -1 }, kernel: null, progress: 0 });
	});
});
