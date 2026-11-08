import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Behavior test for the cashier branch hard-lock.
 *
 * A cashier whose `staff.assigned_branch_id` is set MUST:
 *   1. Have `activeBranchId` snap to their assigned branch on mount.
 *   2. Have `canSwitchBranches === false`.
 *   3. Have any `setActiveBranchId(<other branch>)` attempt rejected
 *      (the active branch stays pinned) — this is the client-side
 *      mirror of the RESTRICTIVE branch-pin RLS policy that scopes
 *      sales_transactions / shifts / cash_events on the server.
 *   4. Have any cross-tab localStorage write that tries to flip them
 *      onto another branch get wiped.
 */

// ---- Mocks ---------------------------------------------------------------

vi.mock("@/contexts/AuthContext", async () => {
  const React = await import("react");
  const cashierAuth = {
    user: { id: "user-cashier-1", email: "cashier@example.com" },
    tenant: { id: "tenant-1" },
    restaurant: { id: "restaurant-1", tenant_id: "tenant-1" },
    hasRole: (r: string) => r === "cashier",
  };
  // Real context so BranchContext's `useContext(AuthContext)` returns our
  // cashier session.
  const AuthContext = React.createContext<any>(cashierAuth);
  return {
    AuthContext,
    useAuth: () => cashierAuth,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const branches = [
    {
      id: "branch-A",
      restaurant_id: "restaurant-1",
      name: "Branch A (assigned)",
      code: "A",
      is_primary: true,
      is_active: true,
    },
    {
      id: "branch-B",
      restaurant_id: "restaurant-1",
      name: "Branch B (forbidden)",
      code: "B",
      is_primary: false,
      is_active: true,
    },
  ];

  function makeBranchesChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      then: (resolve: (v: any) => void) =>
        Promise.resolve({ data: branches, error: null }).then(resolve),
    };
    return chain;
  }

  function makeStaffChain() {
    // Mirror BranchContext: staff.select().eq().eq().eq().not().limit().maybeSingle()
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: { assigned_branch_id: "branch-A" },
          error: null,
        }),
    };
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === "branches") return makeBranchesChain();
        if (table === "staff") return makeStaffChain();
        // Fallback: empty result
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (v: any) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return chain;
      },
    },
  };
});

import { BranchProvider, useBranch } from "@/contexts/BranchContext";

function Probe() {
  const {
    activeBranchId,
    setActiveBranchId,
    canSwitchBranches,
    pinnedBranchId,
  } = useBranch();
  return (
    <div>
      <span data-testid="active">{activeBranchId ?? "none"}</span>
      <span data-testid="pinned">{pinnedBranchId ?? "none"}</span>
      <span data-testid="can-switch">{String(canSwitchBranches)}</span>
      <button
        data-testid="try-switch-B"
        onClick={() => setActiveBranchId("branch-B")}
      >
        switch to B
      </button>
      <button
        data-testid="try-switch-all"
        onClick={() => setActiveBranchId("all")}
      >
        switch to all
      </button>
    </div>
  );
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BranchProvider>
        <Probe />
      </BranchProvider>
    </QueryClientProvider>,
  );
}

describe("cashier branch hard-lock", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("pins the cashier to their assigned branch on mount", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId("pinned").textContent).toBe("branch-A");
      expect(screen.getByTestId("active").textContent).toBe("branch-A");
      expect(screen.getByTestId("can-switch").textContent).toBe("false");
    });
  });

  it("rejects attempts to switch to a non-assigned branch", async () => {
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("branch-A"),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("try-switch-B"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("try-switch-all"));
    });

    // Must still be pinned to branch-A.
    expect(screen.getByTestId("active").textContent).toBe("branch-A");

    // And no stray localStorage entry must survive the attempt.
    expect(localStorage.getItem("matbex.activeBranch.tenant-1")).toBeNull();
  });

  it("wipes a cross-tab localStorage write that targets another branch", async () => {
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("branch-A"),
    );

    const key = "matbex.activeBranch.tenant-1";
    localStorage.setItem(key, "branch-B");
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: "branch-B",
          oldValue: null,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("active").textContent).toBe("branch-A");
      expect(localStorage.getItem(key)).toBeNull();
    });
  });
});