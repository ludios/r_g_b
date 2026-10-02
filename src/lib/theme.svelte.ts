// Model-output: Claude Fable 5.1

// The page's own light or dark look: the browser's preference, unless the user overrides it.
import { getLogger } from "@logtape/logtape";

const log = getLogger(["r_g_b", "theme"]);

/** `system` follows the browser; the others override it. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** Also read by the inline script in app.html, which applies an override before the first paint. */
export const STORAGE_KEY = "r_g_b-theme";

/** The theme named by `text`, or `system` for anything else. */
export function parse_theme(text: string | null): Theme {
	return THEMES.find((theme) => theme === text) ?? "system";
}

/**
 * The choice as reactive state, loaded from and saved to `storage` (null during SSR and in
 * tests without one). Only an override is stored; `system` clears it.
 */
export class ThemeChoice {
	theme = $state<Theme>("system");

	constructor(private storage: Storage | null) {
		try {
			this.theme = parse_theme(storage?.getItem(STORAGE_KEY) ?? null);
		} catch (error) {
			log.warn("could not read the stored theme: {error}", { error });
		}
	}

	set(theme: Theme): void {
		this.theme = theme;
		try {
			if (theme === "system") {
				this.storage?.removeItem(STORAGE_KEY);
			} else {
				this.storage?.setItem(STORAGE_KEY, theme);
			}
		} catch (error) {
			log.warn("could not save the theme; it will not survive a reload: {error}", { error });
		}
	}
}
