/** Open checks / running tabs: /api/v1/pos/checks (server/src/modules/pos/checks.*). */
import { apiRequest } from "./http";
import type { RecordSaleResult, SaleLineSize, SaleTender } from "./pos";

export interface CheckLineInput {
  menuItemId?: string;
  comboId?: string;
  size?: SaleLineSize;
  quantity: number;
  /** The price the screen showed; 409 price_changed when it is no longer current. */
  unitPrice?: number;
  note?: string | null;
}

export interface CheckLine {
  id: string;
  menuItemId: string | null;
  comboId: string | null;
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
  /** null = not sent to the kitchen yet. */
  roundNumber: number | null;
  status: "active" | "voided";
  createdAt: string;
}

export interface CheckSummary {
  id: string;
  checkNumber: string;
  name: string | null;
  status: "open" | "paid" | "void" | "merged";
  branchId: string | null;
  tableId: string | null;
  tableLabel: string | null;
  guestCount: number | null;
  serverId: string | null;
  openedAt: string;
  version: number;
  itemCount: number;
  unsentCount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface CheckDetail extends CheckSummary {
  customerId: string | null;
  notes: string | null;
  lines: CheckLine[];
  rounds: { id: string; number: number; sentAt: string; kdsTicketId: string | null }[];
}

export type PaidSale = RecordSaleResult & { billPart?: { groupId: string; index: number; count: number } };

export interface PayCheckResult {
  check: CheckDetail;
  sales: PaidSale[];
  billGroupId: string | null;
  replayed?: boolean;
}

export async function listOpenChecks(restaurantId: string, branchId?: string | null) {
  const q = new URLSearchParams({ restaurantId, ...(branchId ? { branchId } : {}) });
  const { data } = await apiRequest<{ checks: CheckSummary[] }>(`/pos/checks?${q}`);
  return data.checks;
}

export async function getCheck(id: string, restaurantId: string) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}?restaurantId=${encodeURIComponent(restaurantId)}`);
  return data;
}

export async function openCheck(input: {
  restaurantId: string;
  branchId?: string | null;
  tableId?: string | null;
  name?: string | null;
  guestCount?: number | null;
  lines?: CheckLineInput[];
  send?: boolean;
}) {
  const { data } = await apiRequest<CheckDetail>("/pos/checks", { body: input });
  return data;
}

export async function addCheckLines(id: string, input: { restaurantId: string; expectedVersion?: number; lines: CheckLineInput[]; send?: boolean }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/lines`, { body: input });
  return data;
}

export async function editCheckLine(id: string, lineId: string, input: { restaurantId: string; expectedVersion?: number; quantity?: number; note?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/lines/${lineId}`, { method: "PATCH", body: input });
  return data;
}

export async function voidCheckLine(id: string, lineId: string, input: { restaurantId: string; expectedVersion?: number; reason?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/lines/${lineId}/void`, { body: input });
  return data;
}

export async function sendCheck(id: string, input: { restaurantId: string; expectedVersion?: number }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/send`, { body: input });
  return data;
}

export async function voidCheck(id: string, input: { restaurantId: string; expectedVersion?: number; reason?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/void`, { body: input });
  return data;
}

/** Pays the check: `payments` (one sale) or `parts` (split bill). Reuse the key when retrying. */
export async function payCheck(
  id: string,
  input: {
    restaurantId: string;
    expectedVersion?: number;
    shiftId?: string | null;
    payments?: SaleTender[];
    parts?: { lines: CheckLineInput[]; payments?: SaleTender[] }[];
  },
  opts: { idempotencyKey: string },
) {
  const { data } = await apiRequest<PayCheckResult>(`/pos/checks/${id}/pay`, {
    body: input,
    headers: { "idempotency-key": opts.idempotencyKey },
  });
  return data;
}

/** A check line in the sale-line shape the payment endpoints compare against. */
export function checkSaleLine(l: Pick<CheckLine, "menuItemId" | "comboId" | "size" | "quantity" | "unitPrice">): CheckLineInput {
  return l.comboId
    ? { comboId: l.comboId, quantity: l.quantity, unitPrice: l.unitPrice }
    : { menuItemId: l.menuItemId!, size: l.size as SaleLineSize, quantity: l.quantity, unitPrice: l.unitPrice };
}
