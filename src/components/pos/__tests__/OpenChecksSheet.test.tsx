import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useTableChanges", () => ({ useTableChanges: () => {} }));
vi.mock("@/lib/offline/connectivity", () => ({ isOnline: () => true }));
vi.mock("@/integrations/db/client", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order"]) q[m] = () => q;
  q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
  return { db: { from: () => q } };
});

const { summary, detail, api } = vi.hoisted(() => {
const summary = {
  id: "c1", checkNumber: "CHK-20261124-001", name: null, status: "open", branchId: "b1", tableId: "t1", tableLabel: "5",
  guestCount: 2, serverId: "u1", openedAt: new Date().toISOString(), version: 3, itemCount: 1, unsentCount: 0, subtotal: 20, tax: 3, total: 23,
};
const detail = {
  ...summary, customerId: null, notes: null, rounds: [{ id: "r1", number: 1, sentAt: "", kdsTicketId: "k1" }],
  lines: [{ id: "l1", menuItemId: "burger", comboId: null, name: "Burger", size: "regular", quantity: 1, unitPrice: 23, lineTotal: 23, note: null, roundNumber: 1, status: "active", createdAt: "" }],
};
const api = {
  listOpenChecks: vi.fn(async () => [summary]),
  getCheck: vi.fn(async () => detail),
  addCheckLines: vi.fn(async () => ({ ...detail, version: 4 })),
  voidCheckLine: vi.fn(async () => ({ ...detail, version: 4 })),
  payCheck: vi.fn(async () => ({
    check: { ...detail, status: "paid" }, billGroupId: null,
    sales: [{ transaction: { id: "s1", receipt_number: "RCP-1", subtotal: 20, tax: 3, total: 23, settlement_status: "paid", payment_method: "cash", created_at: "", branch_id: "b1" }, receiptNumber: "RCP-1", payments: [], salesItems: [], lowStock: [] }],
  })),
};
return { summary, detail, api };
});
vi.mock("@/lib/api/checks", async (orig) => ({ ...(await orig<typeof import("@/lib/api/checks")>()), ...api }));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

import { OpenChecksSheet, type OpenChecksSheetProps } from "../OpenChecksSheet";

function setup(over: Partial<OpenChecksSheetProps> = {}) {
  const props: OpenChecksSheetProps = {
    open: true, onOpenChange: vi.fn(), restaurantId: "r1", branchId: "b1", shiftId: "s1", vatRate: 0.15, pricesInclusive: true,
    cart: [], onCartAdded: vi.fn(), chargeCard: null, onPaid: vi.fn(), formatCurrency: (n) => n.toFixed(2), ...over,
  };
  render(<QueryClientProvider client={new QueryClient()}><OpenChecksSheet {...props} /></QueryClientProvider>);
  return props;
}

describe("OpenChecksSheet", () => {
  beforeEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockClear());
  });

  it("adds the POS cart to a check and sends it to the kitchen", async () => {
    const props = setup({ cart: [{ name: "Fries", line: { menuItemId: "fries", size: "regular", quantity: 2, unitPrice: 9 } }] });
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.table:\{"label":"5"\}/ }));
    await waitFor(() => expect(api.addCheckLines).toHaveBeenCalledTimes(1));
    expect(api.addCheckLines.mock.calls[0]).toEqual(["c1", { restaurantId: "r1", expectedVersion: 3, lines: [{ menuItemId: "fries", size: "regular", quantity: 2, unitPrice: 9 }], send: true }]);
    expect(props.onCartAdded).toHaveBeenCalled();
  });

  it("pays a check in cash with its version and hands the sale to the screen", async () => {
    const props = setup();
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.table:\{"label":"5"\}/ }));
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.pay:/ }));
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.payNow:/ }));
    await waitFor(() => expect(api.payCheck).toHaveBeenCalledTimes(1));
    const [id, input, opts] = api.payCheck.mock.calls[0] as unknown as [string, { expectedVersion: number; shiftId: string; payments: unknown[] }, { idempotencyKey: string }];
    expect([id, input.expectedVersion, input.shiftId]).toEqual(["c1", 3, "s1"]);
    expect(input.payments).toEqual([{ method: "cash", amount: 23, tendered: null, cardTerminal: null }]);
    expect(typeof opts.idempotencyKey).toBe("string");
    await waitFor(() => expect(props.onPaid).toHaveBeenCalledTimes(1));
    const [parts] = (props.onPaid as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(parts.map((p: { receiptNumber: string }) => p.receiptNumber)).toEqual(["RCP-1"]);
  });

  it("voids a sent item with a reason and the admin PIN", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.table:\{"label":"5"\}/ }));
    fireEvent.click(await screen.findByRole("button", { name: /app\.pos\.checks\.voidItem:\{"item":"Burger"\}/ }));
    const confirm = await screen.findByRole("button", { name: "app.pos.checks.confirm" });
    expect(confirm).toBeDisabled(); // a reason is required
    fireEvent.change(screen.getByLabelText("app.pos.checks.reason"), { target: { value: "guest changed mind" } });
    fireEvent.change(screen.getByLabelText("app.pos.checks.adminPin"), { target: { value: "12a34" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.voidCheckLine).toHaveBeenCalledTimes(1));
    expect(api.voidCheckLine.mock.calls[0]).toEqual(["c1", "l1", { restaurantId: "r1", expectedVersion: 3, reason: "guest changed mind", quantity: 1, adminPin: "1234" }]);
  });
});
