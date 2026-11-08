import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory kv mock — the real db.ts requires IndexedDB which isn't in jsdom.
const store = new Map<string, unknown>();
vi.mock("../db", () => ({
  kvGet: vi.fn(async (k: string) => store.get(k)),
  kvSet: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v);
  }),
}));

import { nextLamport, currentLamport, __resetLamportForTests } from "../lamport";

beforeEach(() => {
  store.clear();
  __resetLamportForTests();
});

describe("lamport clock", () => {
  it("starts at 1 on the first tick", async () => {
    expect(await nextLamport()).toBe(1);
    expect(await currentLamport()).toBe(1);
  });

  it("is strictly monotonic", async () => {
    const a = await nextLamport();
    const b = await nextLamport();
    const c = await nextLamport();
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(c).toBe(3);
  });

  it("resumes from the persisted value after reload", async () => {
    await nextLamport();
    await nextLamport();
    // Simulate reload: clear in-memory cache but keep the kv store.
    __resetLamportForTests();
    expect(await nextLamport()).toBe(3);
  });
});