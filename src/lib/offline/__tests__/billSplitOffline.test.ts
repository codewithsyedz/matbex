import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Split bill offline: the parts queue as ONE order that replays through
 * POST /api/v1/pos/sales/bill-split (server/functions/pos-sync), each part with its own
 * printed receipt number.
 */
const stores: Record<string, Map<string, any>> = { sync_queue: new Map(), orders: new Map(), payments: new Map(), invoices: new Map() };
vi.mock("../db", () => ({
  STORES: { queue: "sync_queue", orders: "orders", payments: "payments", invoices: "invoices" },
  put: vi.fn(async (store: string, row: any) => stores[store].set(row.queue_id ?? row.local_id, row)),
}));
vi.mock("../crypto", () => ({ protectPayload: vi.fn(async (p: unknown) => p) }));
let seq = 0;
vi.mock("../terminal", () => ({
  getTerminalId: async () => "term-abc123",
  generateLocalReceiptNumber: async () => `OFF-TERM-${String(++seq).padStart(4, "0")}`,
  buildIdempotencyKey: (t: string, e: string, id: string) => `${t}:${e}:${id}`,
}));
vi.mock("../syncEngine", () => ({ runSync: vi.fn() }));
vi.mock("../connectivity", () => ({ isOnline: () => false }));
vi.mock("../backgroundSync", () => ({ requestBackgroundSync: vi.fn() }));
vi.mock("../checksum", () => ({ computeChecksum: async () => "x" }));
vi.mock("../lamport", () => ({ nextLamport: async () => 1 }));

import { recordOfflineSale } from "../posService";

const item = (id: string, quantity: number, unit_price: number) => ({ menu_item_id: id, name: id, size: "regular", quantity, unit_price });

describe("offline split bill", () => {
  beforeEach(() => {
    for (const m of Object.values(stores)) m.clear();
    seq = 0;
  });

  it("queues one order holding every part with its own receipt number", async () => {
    const res = await recordOfflineSale({
      branchId: "r1",
      cashierId: "u1",
      shiftId: "s1",
      paymentMethod: "split",
      idempotencyKey: "bill-key",
      vatRate: 0.15,
      pricesVatInclusive: true,
      documentDiscount: 5,
      items: [item("burger", 2, 25), item("coffee", 1, 12)],
      billParts: [
        { items: [item("burger", 1, 25), item("coffee", 1, 12)], total: 34.87, payments: [{ method: "cash", amount: 34.87, tendered: 50 }] },
        { items: [item("burger", 1, 25)], total: 22.13, payments: [{ method: "card", amount: 22.13 }] },
      ],
    });
    expect(res.receiptNumbers).toEqual(["OFF-TERM-0001", "OFF-TERM-0002"]);
    expect(res.receiptNumber).toBe("OFF-TERM-0001");
    expect(res.total).toBe(57);

    const orders = [...stores.orders.values()];
    expect(orders).toHaveLength(1);
    const p = orders[0].payload;
    expect(p.document_discount).toBe(5);
    expect(p.bill_parts.map((b: any) => b.receipt_number)).toEqual(["OFF-TERM-0001", "OFF-TERM-0002"]);
    expect(p.bill_parts[0].payments).toEqual([{ method: "cash", amount: 34.87, tendered: 50, card_terminal: null }]);
    expect(p.items).toHaveLength(2);

    const queue = [...stores.sync_queue.values()];
    expect(queue.filter((q) => q.entity_type === "ORDER")).toHaveLength(1);
    expect(queue.find((q) => q.entity_type === "ORDER").idempotency_key).toBe("bill-key");
  });

  it("refuses a part whose payments do not add up to it", async () => {
    await expect(
      recordOfflineSale({
        branchId: "r1",
        cashierId: "u1",
        shiftId: null,
        paymentMethod: "split",
        items: [item("burger", 2, 25)],
        billParts: [
          { items: [item("burger", 1, 25)], total: 25, payments: [{ method: "cash", amount: 25 }] },
          { items: [item("burger", 1, 25)], total: 25, payments: [{ method: "cash", amount: 20 }] },
        ],
      }),
    ).rejects.toThrow(/Guest 2/);
    expect(stores.orders.size).toBe(0);
  });
});
