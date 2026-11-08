import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock react-i18next so the component renders with default English fallback.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

// Mock useAuth — variable swapped per test.
let mockAuth: any = {};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

import { RoleImpersonationBanner } from "../RoleImpersonationBanner";

describe("RoleImpersonationBanner a11y", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders nothing when not impersonating", () => {
    mockAuth = {
      isRoleImpersonating: false,
      impersonatedRole: null,
      stopRoleImpersonation: vi.fn(),
      profile: null,
      impersonationExpiresAt: null,
    };
    const { container } = render(<RoleImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes the role change to assistive tech via aria-live region", () => {
    mockAuth = {
      isRoleImpersonating: true,
      impersonatedRole: "manager",
      stopRoleImpersonation: vi.fn(),
      profile: { full_name: "Owner Name" },
      impersonationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    render(<RoleImpersonationBanner />);

    const banner = screen.getByTestId("impersonation-banner");
    // role=status implies polite, but we set it explicitly so audits don't
    // depend on UA behaviour. aria-atomic ensures the full message is
    // re-announced when the role pill changes.
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-atomic", "true");

    const pill = screen.getByTestId("impersonation-role-pill");
    expect(pill).toHaveTextContent("Manager");
  });

  it("re-mounts the role pill on role change so screen readers re-announce", () => {
    mockAuth = {
      isRoleImpersonating: true,
      impersonatedRole: "manager",
      stopRoleImpersonation: vi.fn(),
      profile: null,
      impersonationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const { rerender } = render(<RoleImpersonationBanner />);
    const first = screen.getByTestId("impersonation-role-pill");
    expect(first).toHaveTextContent("Manager");

    mockAuth = { ...mockAuth, impersonatedRole: "cashier" };
    rerender(<RoleImpersonationBanner />);
    expect(screen.getByTestId("impersonation-role-pill")).toHaveTextContent(
      "Cashier",
    );
  });
});