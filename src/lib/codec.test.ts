// Model-output: Claude Opus 5.5
import { assert, boolean, constantFrom, double, integer, property, record } from "fast-check";
import { describe, expect, test } from "vitest";
import { decode, encode } from "./codec";
import { MAX_SEED } from "./kernel";
import { DEFAULT_SETTINGS, PARAMS, SLIDERS } from "./settings";

const slider = (key: keyof typeof SLIDERS) => double({ min: SLIDERS[key].min, max: SLIDERS[key].max, noNaN: true });
const settings = record({
	contrast:    slider("contrast"),
	morph:       boolean(),
	morph_steps: integer({ min: SLIDERS.morph_steps.min, max: SLIDERS.morph_steps.max }),
	spacing:     slider("spacing"),
	jitter:      slider("jitter"),
	persistence: slider("persistence"),
	speed:       slider("speed"),
	ground:      slider("ground"),
	mouse_x:     constantFrom(null, ...PARAMS),
	mouse_y:     constantFrom(null, ...PARAMS),
});

describe("codec", () => {
	test("decodes what it encodes", () => {
		assert(property(settings, integer({ min: 0, max: MAX_SEED }), (s, seed) => {
			expect(decode(encode(s, seed))).toEqual({ settings: s, seed });
		}));
	});

	test("writes only the seed for the defaults", () => {
		expect(encode(DEFAULT_SETTINGS, 7)).toBe("k=7");
	});

	test("reads junk as the defaults, and numbers past an end as that end", () => {
		expect(decode("?k=-1&c=pony&mx=everything&m=yes")).toEqual({ settings: DEFAULT_SETTINGS, seed: null });
		expect(decode("").settings).toEqual(DEFAULT_SETTINGS);
		expect(decode("s=9999&p=-3&k=1.5")).toEqual({ settings: { ...DEFAULT_SETTINGS, spacing: SLIDERS.spacing.max, persistence: 0 }, seed: null });
	});
});
