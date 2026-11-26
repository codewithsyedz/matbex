import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Keys come back as "key" or "key:{opts}", so the test finds controls by key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));

const quoteBillSplit = vi.fn();
const recordBillSplit = vi.fn();
vi.mock("@/lib/api/pos", () => ({
  quoteBillSplit: (...a: unknown[]) => quoteBillSplit(...a),
  recordBillSplit: (...a: unknown[]) => recordBillSplit(...a),
}));
const recordOfflineSale = vi.fn();
vi.mock("@/lib/offline/posService", () => ({ recordOfflineSale: (...a: unknown[]) => recordOfflineSale(...a) }));
vi.mock("@/lib/offline/connectivity", () => ({ isOnline: () => true }));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

import { SplitBillSheet, type SplitBillSheetProps } from "../SplitBillSheet";

const lines = [
  { key: "0:b", menuItemId: "burger", name: "Burger", size: "regular" as const, quantity: 2, unitPrice: 25 },
  { key: "1:c", menuItemId: "coffee", name: "Coffee", size: "regular" as const, quantity: 1, unitPrice: 12 },
];

function setup(over: Partial<SplitBillSheetProps> = {}) {
  const props: SplitBillSheetProps = {
    open: true,
    onOpenChange: vi.fn(),
    lines,
    total: 62,
    vatRate: 0.15,
    pricesInclusive: true,
    order: { restaurantId: "r1", branchId: "b1", shiftId: "s1" },
    offline: { cashierId: "u1" },
    chargeCard: null,
    onTenders: vi.fn(),
    onRecorded: vi.fn(),
    formatCurrency: (n) => n.toFixed(2),
    ...over,
  };
  render(<SplitBillSheet {...props} />);
  return props;
}

const button = (re: RegExp) => screen.getByRole("button", { name: re });

describe("SplitBillSheet", () => {
  beforeEach(() => {
    cleanup();
    quoteBillSplit.mockReset();
    recordBillSplit.mockReset();
  });

  it("by item: guests pay in turn, then every part is recorded in one request", async () => {
    quoteBillSplit.mockResolvedValue({ parts: [{ subtotal: 32.17, tax: 4.83, total: 37, documentDiscount: 0, documentSurcharge: 0 }, { subtotal: 21.74, tax: 3.26, total: 25, documentDiscount: 0, documentSurcharge: 0 }], total: 62 });
    recordBillSplit.mockImplementation(async (input: { parts: unknown[] }) => ({
      billGroupId: "g",
      sales: input.parts.map((_, i) => ({
        transaction: { id: `s${i}`, receipt_number: `RCP-${i}`, subtotal: 0, tax: 0, total: [37, 25][i], settlement_status: "paid", payment_method: "cash", created_at: "", branch_id: "b1" },
        receiptNumber: `RCP-${i}`,
        payments: [],
        salesItems: [],
        lowStock: [],
        billPart: { groupId: "g", index: i + 1, count: 2 },
      })),
    }));
    const props = setup();

    // Guest 1: one burger and the coffee; guest 2: the other burger.
    fireEvent.click(button(/giveOne:.*"item":"Burger","guest":1/));
    fireEvent.click(button(/giveOne:.*"item":"Coffee","guest":1/));
    fireEvent.click(screen.getByRole("tab", { name: /guestN:\{"n":2\}/ }));
    fireEvent.click(button(/giveOne:.*"item":"Burger","guest":2/));
    fireEvent.click(button(/toPayment/));

    await waitFor(() => expect(quoteBillSplit).toHaveBeenCalledTimes(1));
    const quoted = quoteBillSplit.mock.calls[0][0];
    expect(quoted.parts).toEqual([
      { lines: [{ menuItemId: "burger", size: "regular", quantity: 1, unitPrice: 25 }, { menuItemId: "coffee", size: "regular", quantity: 1, unitPrice: 12 }] },
      { lines: [{ menuItemId: "burger", size: "regular", quantity: 1, unitPrice: 25 }] },
    ]);

    fireEvent.click(await screen.findByRole("button", { name: /takePayment:\{"n":1/ }));
    expect(recordBillSplit).not.toHaveBeenCalled();
    fireEvent.click(button(/takePayment:\{"n":2/));

    await waitFor(() => expect(recordBillSplit).toHaveBeenCalledTimes(1));
    const [input, opts] = recordBillSplit.mock.calls[0];
    expect(input.lines).toHaveLength(2);
    expect(input.parts.map((p: { payments: unknown[] }) => p.payments)).toEqual([
      [{ method: "cash", amount: 37, tendered: null, cardTerminal: null }],
      [{ method: "cash", amount: 25, tendered: null, cardTerminal: null }],
    ]);
    expect(typeof opts.idempotencyKey).toBe("string");
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    const parts = (props.onRecorded as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(parts.map((p: { receiptNumber: string; index: number }) => [p.receiptNumber, p.index])).toEqual([["RCP-0", 1], ["RCP-1", 2]]);
  });

  it("evenly: hands N equal tenders (last takes the rounding) to the split-tender panel", () => {
    const props = setup({ total: 100 });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "app.pos.billSplit.evenly" }));
    fireEvent.click(screen.getByRole("tab", { name: "app.pos.billSplit.evenly" }));
    fireEvent.click(button(/moreGuests/));
    fireEvent.click(button(/payInParts/));
    expect(props.onTenders).toHaveBeenCalledWith([33.33, 33.33, 33.34]);
  });
});
