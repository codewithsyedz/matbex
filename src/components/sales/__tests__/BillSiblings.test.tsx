import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ format: (n: number) => n.toFixed(2) }) }));

const rows = [
  { id: "b", receipt_number: "RCP-20261123-0004", total: 46, voided_at: null },
  { id: "a", receipt_number: "RCP-20261123-0003", total: 23, voided_at: "2026-11-23T18:00:00Z" },
];
const calls: unknown[][] = [];
vi.mock("@/integrations/db/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (...a: unknown[]) => { calls.push(a); return q; };
  q.then = (res: (v: unknown) => void) => res({ data: rows, error: null });
  return { db: { from: () => q } };
});

import { BillSiblings } from "../BillSiblings";

describe("BillSiblings", () => {
  it("lists every part of the bill in receipt order, marking this sale and voided parts", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BillSiblings restaurantId="r1" billGroupId="g1" currentId="b" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('app.sales.billSiblings.title:{"index":2,"count":2}')).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("RCP-20261123-0003");
    expect(items[0]).toContain("app.sales.billSiblings.voided");
    expect(items[1]).toContain("RCP-20261123-0004");
    expect(items[1]).toContain("app.sales.billSiblings.thisSale");
    // Scoped to the restaurant and the bill group.
    expect(calls).toContainEqual(["restaurant_id", "r1"]);
    expect(calls).toContainEqual(["bill_group_id", "g1"]);
  });
});
