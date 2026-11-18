import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCacheForTests, clearAllCaches, clearCacheForOperator, readCache, writeCache,
} from "./local-cache";

function storage() {
  const entries = new Map([
    ["studio-cache:op:shad:dashboard", JSON.stringify({ v: 1, savedAt: 1, value: { hours: 3 } })],
    ["theme", "dark"],
  ]);
  vi.stubGlobal("window", { localStorage: {
    get length() { return entries.size; },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (k: string) => entries.get(k) ?? null,
    removeItem: (k: string) => { entries.delete(k); },
    setItem: vi.fn(),
  } });
  return entries;
}

beforeEach(() => __resetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("session cache", () => {
  it("never shows data saved during an earlier visit, and purges it", () => {
    const entries = storage();
    expect(readCache("op:shad:dashboard")).toBeNull();
    expect([...entries.keys()]).toEqual(["theme"]);
  });

  it("returns what was shown earlier in the same session", () => {
    storage();
    writeCache("op:shad:dashboard", { hours: 9 });
    expect(readCache("op:shad:dashboard")).toEqual({ hours: 9 });
  });

  it("clears per operator and on sign-out", () => {
    storage();
    writeCache("op:shad:a", 1);
    writeCache("op:anna:a", 2);
    clearCacheForOperator("Shad");
    expect(readCache("op:shad:a")).toBeNull();
    expect(readCache("op:anna:a")).toBe(2);
    clearAllCaches();
    expect(readCache("op:anna:a")).toBeNull();
  });

  it("does nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    writeCache("k", 1);
    expect(readCache("k")).toBeNull();
  });
});
