/**
 * Epic E1 — Offline sale round-trip.
 *
 * Login → open shift → toggle browser offline → record 3 sales →
 * toggle back online → wait for the sync engine to drain →
 * assert every receipt reached the cloud with its original
 * idempotency key.
 *
 * The spec is env-gated: missing credentials => skip (never fail CI).
 * Run with:
 *   bunx playwright test --config e2e/playwright.config.ts
 */
import { test, expect } from "@playwright/test";

const {
  E2E_CASHIER_EMAIL,
  E2E_CASHIER_PASSWORD,
  E2E_BRANCH_ID,
} = process.env;

const hasCreds = !!(E2E_CASHIER_EMAIL && E2E_CASHIER_PASSWORD && E2E_BRANCH_ID);

test.describe("Offline POS sale round-trip", () => {
  test.skip(!hasCreds, "Set E2E_CASHIER_EMAIL/PASSWORD/BRANCH_ID to run.");

  test("records 3 sales offline and syncs them all on reconnect", async ({ page, context }) => {
    // ---- 1. Login ----
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(E2E_CASHIER_EMAIL!);
    await page.getByLabel(/password/i).fill(E2E_CASHIER_PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Cashiers are locked to /record-sale.
    await page.waitForURL(/\/(record-sale|shifts)/, { timeout: 15_000 });

    // ---- 2. Open shift if the app landed on /shifts ----
    if (page.url().includes("/shifts")) {
      const openBtn = page.getByRole("button", { name: /open shift/i });
      if (await openBtn.isVisible().catch(() => false)) {
        await openBtn.click();
        await page.getByLabel(/opening balance/i).fill("0");
        await page.getByRole("button", { name: /confirm|open/i }).click();
      }
      await page.goto("/record-sale");
    }

    // ---- 3. Go OFFLINE ----
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // ---- 4. Record 3 sales via the exposed offline POS service ----
    const idemKeys: string[] = await page.evaluate(async (branchId) => {
      // The app re-exports posService on window in dev builds; if not,
      // dynamic-import from the module directly.
      const mod = await import("/src/lib/offline/posService.ts");
      const keys: string[] = [];
      for (let i = 0; i < 3; i++) {
        const rec = await mod.recordOfflineOrder({
          branch_id: branchId,
          cashier_id: "e2e-cashier",
          terminal_id: "e2e-term",
          business_date: new Date().toISOString().slice(0, 10),
          payload: {
            receipt_number: `E2E-${Date.now()}-${i}`,
            items: [{ menu_item_id: "e2e", qty: 1, unit_price: 10, subtotal: 10 }],
            subtotal: 10,
            total: 10,
          },
        });
        keys.push((rec as any).idempotency_key ?? (rec as any).local_id);
      }
      return keys;
    }, E2E_BRANCH_ID!);

    expect(idemKeys).toHaveLength(3);

    // ---- 5. Reconnect + trigger sync ----
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // Wait for the queue to drain (poll IndexedDB via the exposed engine).
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const mod = await import("/src/lib/offline/syncEngine.ts");
            const q = await mod.getQueueSnapshot();
            return q.filter((i: any) => i.status !== "SYNCED").length;
          }),
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(0);

    // ---- 6. Assert idempotency keys reached the cloud ----
    // We rely on the terminal-api /sales/by-idempotency endpoint if available.
    const found: string[] = await page.evaluate(async (keys) => {
      const { supabase } = await import("/src/integrations/db/client.ts");
      const { data } = await db
        .from("sales")
        .select("idempotency_key")
        .in("idempotency_key", keys);
      return (data ?? []).map((r: any) => r.idempotency_key);
    }, idemKeys);

    expect(found.sort()).toEqual([...idemKeys].sort());
  });
});