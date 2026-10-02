// Model-output: Claude Fable 5.1
// Model-output: Claude Opus 5.5

/** A Storage kept in a Map, for tests, holding `initial` to begin with. */
export function fake_storage(initial: Record<string, string> = {}): Storage {
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
