// Model-output: Claude Opus 5.5
import { AssertionError } from "ayy";
import { describe, expect, test } from "vitest";
import { fake_storage } from "./fake_storage";
import { read_stored, write_stored } from "./storage";

/** Refuses, as a browser can when its storage is full or blocked. */
function refuse(): never {
	throw new DOMException("refused", "QuotaExceededError");
}

/** A Storage that refuses everything. */
function refusing_storage(): Storage {
	return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 };
}

describe("read_stored and write_stored", () => {
	test("keep a value as JSON, and forget it for undefined", () => {
		const storage = fake_storage();
		write_stored(storage, "k", { a: false });
		expect(storage.getItem("k")).toBe('{"a":false}');
		expect(read_stored(storage, "k")).toEqual({ a: false });
		write_stored(storage, "k", undefined);
		expect(storage.getItem("k")).toBeNull();
		expect(read_stored(storage, "k")).toBeNull();
	});

	test("read junk, no storage, or a refusal as nothing, and drop a refused write", () => {
		expect(read_stored(fake_storage({ k: "{not json" }), "k")).toBeNull();
		expect(read_stored(null, "k")).toBeNull();
		expect(read_stored(refusing_storage(), "k")).toBeNull();
		expect(() => write_stored(refusing_storage(), "k", 1)).not.toThrow();
		expect(() => write_stored(null, "k", 1)).not.toThrow();
	});

	test("refuse a value with no JSON", () => {
		expect(() => write_stored(fake_storage(), "k", () => 1)).toThrow(AssertionError);
	});
});
