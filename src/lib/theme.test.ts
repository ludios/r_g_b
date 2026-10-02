// Model-output: Claude Fable 5.1
import { expect, test } from "vitest";
import { STORAGE_KEY, ThemeChoice, parse_theme } from "./theme.svelte";

/** Just enough of the Storage interface for ThemeChoice. */
function fake_storage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		getItem:    (k) => map.get(k) ?? null,
		setItem:    (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear:      () => map.clear(),
		key:        (i) => [...map.keys()][i] ?? null,
		get length() {
			return map.size;
		},
	};
}

test("only an override is stored, and junk reads as system", () => {
	expect(parse_theme(null)).toBe("system");
	expect(parse_theme("purple")).toBe("system");
	expect(new ThemeChoice(fake_storage({ [STORAGE_KEY]: "nonsense" })).theme).toBe("system");
	const storage = fake_storage();
	const choice  = new ThemeChoice(storage);
	expect(choice.theme).toBe("system");
	choice.set("dark");
	expect(storage.getItem(STORAGE_KEY)).toBe("dark");
	expect(new ThemeChoice(storage).theme).toBe("dark");
	choice.set("system");
	expect(storage.getItem(STORAGE_KEY)).toBeNull();
	expect(new ThemeChoice(null).theme).toBe("system");
});
