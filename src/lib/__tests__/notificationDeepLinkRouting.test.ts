import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNotificationDeepLink,
  notificationIdFromSearch,
  paramsOf,
} from "@/lib/notificationDeepLink";

const protectedRouteSrc = readFileSync(
  path.resolve(process.cwd(), "src/components/ProtectedRoute.tsx"),
  "utf8",
);

describe("notification deep link → /sales", () => {
  it("keeps every destination param and tags the notification", () => {
    const href = buildNotificationDeepLink({
      href: "/sales?branch=branch-1&date=2026-08-16",
      notificationId: "notif-1",
      title: "Sales recorded",
      actionLabel: "View sales",
      originPath: "/dashboard",
    });

    const params = paramsOf(href);
    expect(href.startsWith("/sales?")).toBe(true);
    expect(params.branch).toBe("branch-1");
    expect(params.date).toBe("2026-08-16");
    expect(params.notif).toBe("notif-1");
    expect(params.src).toBe("notification");
    expect(notificationIdFromSearch(new URL(href, "http://x").search)).toBe("notif-1");
  });
});

/**
 * Regression: ProtectedRoute redirected to /onboarding while tenant/roles were
 * still hydrating, bouncing notification deep links to /dashboard.
 */
describe("ProtectedRoute redirect guards", () => {
  it("gates redirects behind a settled auth context", () => {
    expect(protectedRouteSrc).toMatch(/const contextsSettled\s*=\s*!loading\s*&&\s*!superAdminLoading/);
  });

  it("only redirects to /onboarding once contexts are settled", () => {
    const onboardingBlock = protectedRouteSrc.slice(
      0,
      protectedRouteSrc.indexOf('Navigate to="/onboarding"'),
    );
    const guardStart = onboardingBlock.lastIndexOf("requireOnboarding");
    expect(onboardingBlock.slice(guardStart)).toContain("contextsSettled");
  });

  it("only applies role lockdowns once contexts are settled", () => {
    expect(protectedRouteSrc).toMatch(/isCashierOnly\s*=\s*contextsSettled/);
    expect(protectedRouteSrc).toMatch(/isAccountantOnly\s*=\s*contextsSettled/);
  });
});
