/**
 * Notification deep linking — /sales must be reachable on first load and
 * survive a refresh.
 *
 * Regression guard: ProtectedRoute used to redirect to /onboarding while
 * tenant/roles were still hydrating, which bounced notification deep links
 * to /dashboard ("redirecting back and forth").
 *
 * Env-gated: missing credentials => skip (never fails CI).
 * Run with:
 *   bunx playwright test --config e2e/playwright.config.ts e2e/notification-deeplink.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD, E2E_BRANCH_ID } = process.env;

const hasCreds = !!(E2E_OWNER_EMAIL && E2E_OWNER_PASSWORD);

const DEEP_LINK = (() => {
  const params = new URLSearchParams({
    notif: "e2e-notification-id",
    src: "notification",
  });
  if (E2E_BRANCH_ID) params.set("branch", E2E_BRANCH_ID);
  return `/sales?${params.toString()}`;
})();

/** Poll the URL for a while and return every distinct URL the app settled on. */
async function trackUrls(page: Page, samples = 8, everyMs = 500): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(everyMs);
    const url = new URL(page.url());
    const current = `${url.pathname}${url.search}`;
    if (seen[seen.length - 1] !== current) seen.push(current);
  }
  return seen;
}

test.describe("Notification deep link → /sales", () => {
  test.skip(!hasCreds, "Set E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD to run.");

  test("lands on /sales on first load and after refresh without bouncing", async ({ page }) => {
    // ---- 1. Sign in ----
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(E2E_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(E2E_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20_000 });

    // ---- 2. Cold load of the notification deep link ----
    await page.goto(DEEP_LINK, { waitUntil: "domcontentloaded" });
    const coldUrls = await trackUrls(page);

    expect(
      coldUrls,
      `deep link bounced through: ${coldUrls.join(" -> ")}`,
    ).toHaveLength(1);
    expect(coldUrls[0]).toContain("/sales");
    expect(coldUrls[0]).toContain("notif=e2e-notification-id");
    expect(coldUrls[0]).not.toContain("/onboarding");
    expect(coldUrls[0]).not.toContain("/dashboard");

    // The page really rendered Sales, not a loader that later redirects.
    await expect(page.getByRole("heading", { name: /^sales$/i })).toBeVisible({
      timeout: 20_000,
    });

    // ---- 3. Refresh twice — the guard must stay settled ----
    for (const attempt of [1, 2]) {
      await page.reload({ waitUntil: "domcontentloaded" });
      const urls = await trackUrls(page);
      expect(urls, `refresh #${attempt} bounced through: ${urls.join(" -> ")}`).toHaveLength(1);
      expect(urls[0]).toContain("/sales");
      expect(urls[0]).toContain("notif=e2e-notification-id");
      if (E2E_BRANCH_ID) expect(urls[0]).toContain(`branch=${E2E_BRANCH_ID}`);
    }
  });
});
