import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, clearCache, clearCacheForOperator, readCache, writeCache } from "./local-cache";

afterEach(() => vi.unstubAllGlobals());

function fullStorage() {
  const entries = new Map([
    ["studio-cache:op:shad:dashboard", JSON.stringify({ v: 1, savedAt: 1, value: { hours: 3 } })],
    ["studio-cache:op:anna:dashboard", JSON.stringify({ v: 1, savedAt: 1, value: { hours: 5 } })],
    ["theme", "dark"],
  ]);
  const setItem = vi.fn(() => { throw new Error("Storage quota exceeded"); });
  vi.stubGlobal("window", { localStorage: {
    get length() { return entries.size; },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => { entries.delete(key); },
    setItem,
  } });
  return { entries, setItem };
}

describe("local cache with full storage", () => {
  it("reads existing data without requiring a successful write", () => {
    const { setItem } = fullStorage();
    expect(readCache("op:shad:dashboard")).toEqual({ hours: 3 });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("removes a single entry even when storage cannot accept writes", () => {
    const { entries } = fullStorage();
    clearCache("op:shad:dashboard");
    expect(entries.has("studio-cache:op:shad:dashboard")).toBe(false);
    expect(entries.has("studio-cache:op:anna:dashboard")).toBe(true);
  });

  it("clears only the requested operator's data", () => {
    const { entries } = fullStorage();
    clearCacheForOperator("Shad");
    expect([...entries.keys()]).toEqual(["studio-cache:op:anna:dashboard", "theme"]);
  });

  it("clears all cached operator data on sign-out while preserving other settings", () => {
    const { entries, setItem } = fullStorage();
    clearAllCaches();
    expect([...entries.keys()]).toEqual(["theme"]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("silently tolerates failed writes and preserves existing data", () => {
    const { setItem } = fullStorage();
    expect(() => writeCache("op:shad:dashboard", { hours: 9 })).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readCache("op:shad:dashboard")).toEqual({ hours: 3 });
  });

  it("silently falls back when access to storage is blocked", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("Storage disabled"); } });
    expect(readCache("op:shad:dashboard")).toBeNull();
    expect(() => {
      writeCache("op:shad:dashboard", {});
      clearCache("op:shad:dashboard");
      clearCacheForOperator("Shad");
      clearAllCaches();
    }).not.toThrow();
  });

  it("supports server rendering without browser storage", () => {
    vi.stubGlobal("window", undefined);
    expect(readCache("op:shad:dashboard")).toBeNull();
    expect(() => { writeCache("op:shad:dashboard", {}); clearAllCaches(); }).not.toThrow();
  });
});