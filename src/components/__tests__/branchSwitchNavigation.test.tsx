import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Link, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * End-to-end-ish guard: switching to a newly-created empty branch must
 * leave the sidebar interactive - no `pointer-events: none` stuck on
 * <body>, and React Router navigation must still work without a refresh.
 *
 * This regression test simulates the historical Radix-popover bug:
 * Radix sometimes sets `document.body.style.pointerEvents = "none"`
 * during close, and if React is mid-refetch (which happens when the
 * active branch changes), the cleanup never runs. We verify
 * BranchContext.releaseBodyPointerLock() restores interactivity and
 * sidebar links remain clickable.
 */

// ---- Mocks ---------------------------------------------------------------

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    tenant: { id: "tenant-1" },
    restaurant: { id: "restaurant-1" },
    hasRole: () => true,
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const branches = [
    {
      id: "branch-existing",
      restaurant_id: "restaurant-1",
      name: "Main",
      code: "M",
      is_primary: true,
      is_active: true,
    },
    {
      id: "branch-new-empty",
      restaurant_id: "restaurant-1",
      name: "New Empty Branch",
      code: "NEB",
      is_primary: false,
      is_active: true,
    },
  ];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    then: (resolve: (v: any) => void) =>
      Promise.resolve({ data: branches, error: null }).then(resolve),
  };
  return {
    supabase: { from: () => chain },
  };
});

// ---- Test harness --------------------------------------------------------

import { BranchProvider, useBranch } from "@/contexts/BranchContext";

function Sidebar() {
  const { branches, activeBranchId, setActiveBranchId, isSwitchingBranch } =
    useBranch();
  return (
    <nav data-testid="sidebar">
      <span data-testid="active-branch">{activeBranchId ?? "none"}</span>
      <span data-testid="switching">{String(isSwitchingBranch)}</span>
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          data-testid={`switch-${b.id}`}
          onClick={() => {
            // Simulate the Radix popover leaving <body> locked while
            // React is busy refetching on the new branch.
            document.body.style.pointerEvents = "none";
            document.body.setAttribute("data-scroll-locked", "1");
            setActiveBranchId(b.id);
          }}
        >
          {b.name}
        </button>
      ))}
      <Link to="/inventory" data-testid="nav-inventory">
        Go to Inventory
      </Link>
    </nav>
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pathname">{loc.pathname}</span>;
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <BranchProvider>
          <Sidebar />
          <LocationProbe />
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/inventory" element={<div>Inventory</div>} />
          </Routes>
        </BranchProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Test ----------------------------------------------------------------

describe("branch switch keeps sidebar navigation alive", () => {
  beforeEach(() => {
    document.body.style.pointerEvents = "";
    document.body.removeAttribute("data-scroll-locked");
  });

  it("switching to a newly created empty branch clears the body pointer lock and allows navigation", async () => {
    renderApp();

    // 1. Wait for branches to hydrate and primary branch to become active.
    await waitFor(() => {
      expect(screen.getByTestId("active-branch").textContent).toBe(
        "branch-existing",
      );
    });

    // 2. Click the new (empty) branch - this also simulates the Radix lock.
    await act(async () => {
      fireEvent.click(screen.getByTestId("switch-branch-new-empty"));
    });

    // 3. The active branch should update.
    await waitFor(() => {
      expect(screen.getByTestId("active-branch").textContent).toBe(
        "branch-new-empty",
      );
    });

    // 4. The body pointer lock must be released by releaseBodyPointerLock()
    //    (runs on a 100ms setTimeout). Poll a bit to allow it to fire.
    await waitFor(
      () => {
        expect(document.body.style.pointerEvents).not.toBe("none");
        expect(document.body.getAttribute("data-scroll-locked")).toBeNull();
      },
      { timeout: 1000 },
    );

    // 5. Sidebar navigation must still work - no refresh required.
    await act(async () => {
      fireEvent.click(screen.getByTestId("nav-inventory"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe("/inventory");
    });
  });
});