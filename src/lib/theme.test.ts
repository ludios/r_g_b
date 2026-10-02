// Model-output: Claude Fable 5.1
import { expect, test } from "vitest";
import { fake_storage } from "./fake_storage";
import { STORAGE_KEY, ThemeChoice, parse_theme } from "./theme.svelte";

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
