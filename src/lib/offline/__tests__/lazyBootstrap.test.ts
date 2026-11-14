import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Flush enough microtasks for chained dynamic-import .then()s to settle. */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
     
    await Promise.resolve();
  }
}

/**
 * These tests guard the performance contract of the offline stack:
 *
 *   1. Importing `@/lib/offline/lazyBootstrap` must NOT pull in the heavy
 *      offline modules (`./index`, `./syncEngine`, `./db`, `./api`,
 *      `./crypto`, `./posService`, `./backgroundSync`, `./connectivity`,
 *      `./auditReport`, `./receiptPdf`).
 *   2. `ensureOfflineBootstrapped()` must dynamically import `./index`
 *      and call `bootstrapOffline()` exactly once.
 *   3. `armOfflineAutoBootstrap()` must NOT boot until the browser
 *      actually fires the `offline` event (or starts offline).
 *   4. `updateBranchIfOfflineStarted()` is a true no-op until the engine
 *      has booted.
 */

// We mock `./index` so importing the lazy module never accidentally
// pulls IndexedDB / SW code into the test environment.
const bootstrapOffline = vi.fn(async (_b: string | null) => {});
const setOfflineBranchId = vi.fn((_b: string | null) => {});

// lazyBootstrap.ts uses `import("./index")`, which resolves to the
// same module id as `../index` from this test file. Mock both spellings
// so it matches no matter how Vitest normalises the id.
vi.mock("../index", () => ({ bootstrapOffline, setOfflineBranchId }));
vi.mock("@/lib/offline", () => ({ bootstrapOffline, setOfflineBranchId }));
vi.mock("@/lib/offline/index", () => ({ bootstrapOffline, setOfflineBranchId }));

async function freshLazy() {
  vi.resetModules();
  bootstrapOffline.mockClear();
  setOfflineBranchId.mockClear();
  return await import("@/lib/offline/lazyBootstrap");
}

describe("lazyBootstrap - eager-import contract", () => {
  it("does NOT eagerly import any heavy offline modules", async () => {
    vi.resetModules();
    const heavy = [
      "@/lib/offline/syncEngine",
      "@/lib/offline/db",
      "@/lib/offline/api",
      "@/lib/offline/crypto",
      "@/lib/offline/posService",
      "@/lib/offline/backgroundSync",
      "@/lib/offline/connectivity",
      "@/lib/offline/auditReport",
      "@/lib/offline/receiptPdf",
    ];
    const spies = heavy.map((id) => {
      const fn = vi.fn();
      // Register a side-effect mock for each heavy module.
      vi.doMock(id, () => {
        fn();
        return {};
      });
      return { id, fn };
    });

    await import("@/lib/offline/lazyBootstrap");

    for (const { id, fn } of spies) {
      expect(fn, `expected ${id} not to be eagerly imported`).not.toHaveBeenCalled();
    }
    spies.forEach(({ id }) => vi.doUnmock(id));
  });
});

describe("ensureOfflineBootstrapped()", () => {
  beforeEach(() => {
    bootstrapOffline.mockClear();
    setOfflineBranchId.mockClear();
  });

  it("boots exactly once on first call and reuses the same promise after", async () => {
    const { ensureOfflineBootstrapped } = await freshLazy();

    const p1 = ensureOfflineBootstrapped("rest-1");
    const p2 = ensureOfflineBootstrapped("rest-1");
    await Promise.all([p1, p2]);

    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
    expect(bootstrapOffline).toHaveBeenCalledWith("rest-1");
    expect(p1).toBe(p2);
  });

  it("propagates a branch change after boot via setOfflineBranchId (not a re-boot)", async () => {
    const { ensureOfflineBootstrapped } = await freshLazy();

    await ensureOfflineBootstrapped("rest-1");
    await ensureOfflineBootstrapped("rest-2");
    await flush();

    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
    expect(setOfflineBranchId).toHaveBeenCalledWith("rest-2");
  });

  it("never double-boots when called concurrently for two different branches", async () => {
    const { ensureOfflineBootstrapped } = await freshLazy();
    // bootstrapOffline takes a tick to resolve, simulating real init work.
    let resolveBoot: (() => void) | null = null;
    bootstrapOffline.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveBoot = () => res(); }),
    );

    const p1 = ensureOfflineBootstrapped("rest-A");
    const p2 = ensureOfflineBootstrapped("rest-B");
    expect(p1).toBe(p2); // same in-flight promise
    // Let the dynamic import("./index") chain reach bootstrapOffline.
    await flush();
    resolveBoot?.();
    await Promise.all([p1, p2]);
    await flush();

    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
    // The second call must take effect AFTER boot resolves.
    expect(setOfflineBranchId).toHaveBeenCalledWith("rest-B");
  });

  it("applies the LAST requested branch id when many switches happen quickly", async () => {
    const { ensureOfflineBootstrapped } = await freshLazy();
    await ensureOfflineBootstrapped("rest-1");
    setOfflineBranchId.mockClear();

    await ensureOfflineBootstrapped("rest-2");
    await ensureOfflineBootstrapped("rest-3");
    await ensureOfflineBootstrapped("rest-3"); // dedup
    await ensureOfflineBootstrapped(null);     // back to "no branch"
    await flush();

    const calls = setOfflineBranchId.mock.calls.map((c) => c[0]);
    // No duplicate call for the same branch in a row.
    expect(calls).toEqual(["rest-2", "rest-3", null]);
    // Boot still ran exactly once.
    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
  });
});

describe("updateBranchIfOfflineStarted()", () => {
  it("is a no-op until ensureOfflineBootstrapped has been called", async () => {
    const { updateBranchIfOfflineStarted } = await freshLazy();
    updateBranchIfOfflineStarted("rest-9");
    // No dynamic import → no calls.
    await Promise.resolve();
    expect(bootstrapOffline).not.toHaveBeenCalled();
    expect(setOfflineBranchId).not.toHaveBeenCalled();
  });

  it("forwards branch updates once the engine has booted", async () => {
    const { ensureOfflineBootstrapped, updateBranchIfOfflineStarted } = await freshLazy();
    await ensureOfflineBootstrapped("rest-1");
    setOfflineBranchId.mockClear();

    updateBranchIfOfflineStarted("rest-2");
    await flush();

    expect(setOfflineBranchId).toHaveBeenCalledWith("rest-2");
  });
});

describe("armOfflineAutoBootstrap()", () => {
  let onlineDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    if (onlineDescriptor) {
      Object.defineProperty(navigator, "onLine", onlineDescriptor);
    }
  });

  it("does NOT boot when armed while online", async () => {
    const { armOfflineAutoBootstrap } = await freshLazy();
    const cleanup = armOfflineAutoBootstrap(() => "rest-1");
    await Promise.resolve();
    expect(bootstrapOffline).not.toHaveBeenCalled();
    cleanup();
  });

  it("boots when the browser fires the `offline` event", async () => {
    const { armOfflineAutoBootstrap } = await freshLazy();
    const cleanup = armOfflineAutoBootstrap(() => "rest-7");

    window.dispatchEvent(new Event("offline"));
    await flush();

    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
    expect(bootstrapOffline).toHaveBeenCalledWith("rest-7");
    cleanup();
  });

  it("boots immediately if the browser is already offline at arm time", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { armOfflineAutoBootstrap } = await freshLazy();
    const cleanup = armOfflineAutoBootstrap(() => "rest-cold");
    await flush();

    expect(bootstrapOffline).toHaveBeenCalledTimes(1);
    expect(bootstrapOffline).toHaveBeenCalledWith("rest-cold");
    cleanup();
  });

  it("removes its `offline` listener on cleanup so no further boots happen", async () => {
    const { armOfflineAutoBootstrap } = await freshLazy();
    const cleanup = armOfflineAutoBootstrap(() => "rest-x");
    cleanup();

    window.dispatchEvent(new Event("offline"));
    await flush();

    expect(bootstrapOffline).not.toHaveBeenCalled();
  });
});