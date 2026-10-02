// Model-output: Claude Fable 5.1

import { browser } from "$app/environment";

/**
 * The browser's localStorage, or null when rendering on the server or when the browser
 * refuses access. Node also has an experimental `localStorage` global that warns when
 * touched, hence the `browser` check before the lookup.
 */
export function local_storage(): Storage | null {
	if (!browser) {
		return null;
	}
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
