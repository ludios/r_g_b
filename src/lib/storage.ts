// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5

import { getLogger } from "@logtape/logtape";
import { browser } from "$app/environment";

const log = getLogger(["r_g_b", "storage"]);

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

/** What's kept as JSON under `key` in `storage`, or null if there's nothing there or it can't be read. */
export function read_stored(storage: Storage | null, key: string): unknown {
	try {
		return JSON.parse(storage?.getItem(key) ?? "null");
	} catch (error) {
		log.warn("could not read {key}: {error}", { key, error });
		return null;
	}
}

/** Keeps `value` as JSON under `key` in `storage`; if the browser won't, it lasts only as long as the page. */
export function write_stored(storage: Storage | null, key: string, value: unknown): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch (error) {
		log.warn("could not keep {key}: {error}", { key, error });
	}
}
