import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Link, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Repeated branch switching must never wedge the UI: after each switch
 * the <body> pointer lock must clear and React Router navigation must
 * keep working without a page refresh. This guards against regressions
 * where Radix re-applies `pointer-events: none` faster than our cleanup.
 */

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    tenant: { id: "tenant-1" },
    restaurant: { id: "restaurant-1" },
    hasRole: () => true,
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const branches = [
    { id: "branch-a", restaurant_id: "restaurant-1", name: "Alpha", code: "A", is_primary: true, is_active: true },
    { id: "branch-b", restaurant_id: "restaurant-1", name: "Bravo", code: "B", is_primary: false, is_active: true },
    { id: "branch-c", restaurant_id: "restaurant-1", name: "Charlie", code: "C", is_primary: false, is_active: true },
  ];
  const makeChain = (result: any): any => {
    const chain: any = {};
    const methods = ["select", "eq", "is", "not", "order", "limit"];
    methods.forEach((m) => { chain[m] = () => chain; });
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (v: any) => void) => Promise.resolve(result).then(resolve);
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "staff") return makeChain({ data: null, error: null });
        return makeChain({ data: branches, error: null });
      },
    },
  };
});

import { BranchProvider, useBranch } from "@/contexts/BranchContext";

function Harness() {
  const { branches, activeBranchId, setActiveBranchId } = useBranch();
  return (
    <div>
      <span data-testid="active-branch">{activeBranchId ?? "none"}</span>
      {branches.map((b) => (
        <button
          key={b.id}
          data-testid={`switch-${b.id}`}
          onClick={() => {
            // Simulate Radix locking the body during close.
            document.body.style.pointerEvents = "none";
            document.body.setAttribute("data-scroll-locked", "1");
            setActiveBranchId(b.id);
          }}
        >
          {b.name}
        </button>
      ))}
      <Link to="/inventory" data-testid="nav-inventory">Inventory</Link>
      <Link to="/dashboard" data-testid="nav-dashboard">Dashboard</Link>
      <Link to="/sales" data-testid="nav-sales">Sales</Link>
    </div>
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pathname">{loc.pathname}</span>;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <BranchProvider>
          <Harness />
          <LocationProbe />
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/inventory" element={<div>Inventory</div>} />
            <Route path="/sales" element={<div>Sales</div>} />
          </Routes>
        </BranchProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("repeated branch switching keeps navigation alive", () => {
  beforeEach(() => {
    document.body.style.pointerEvents = "";
    document.body.removeAttribute("data-scroll-locked");
    localStorage.clear();
  });

  it("survives 5 sequential switches across 3 branches", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId("active-branch").textContent).toBe("branch-a");
    });

    const sequence: Array<{ branch: string; navTo: string; navTestId: string }> = [
      { branch: "branch-b", navTo: "/inventory", navTestId: "nav-inventory" },
      { branch: "branch-c", navTo: "/dashboard", navTestId: "nav-dashboard" },
      { branch: "branch-a", navTo: "/sales", navTestId: "nav-sales" },
      { branch: "branch-c", navTo: "/inventory", navTestId: "nav-inventory" },
      { branch: "branch-b", navTo: "/dashboard", navTestId: "nav-dashboard" },
    ];

    for (const step of sequence) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(`switch-${step.branch}`));
      });

      await waitFor(() => {
        expect(screen.getByTestId("active-branch").textContent).toBe(step.branch);
      });

      // Body lock must be released so the UI stays clickable.
      await waitFor(
        () => {
          expect(document.body.style.pointerEvents).not.toBe("none");
          expect(document.body.getAttribute("data-scroll-locked")).toBeNull();
        },
        { timeout: 1500 },
      );

      // Router navigation must still work after the switch.
      await act(async () => {
        fireEvent.click(screen.getByTestId(step.navTestId));
      });

      await waitFor(() => {
        expect(screen.getByTestId("pathname").textContent).toBe(step.navTo);
      });
    }

    // Final sanity: body is clean and nav still works.
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(document.body.getAttribute("data-scroll-locked")).toBeNull();
  });
});