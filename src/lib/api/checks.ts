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
  /** Active lines at their stored prices (listed). */
  linesTotal: number;
  /** Branch service charge on the check (0 when off or waived); included in total. */
  serviceChargePercent: number;
  serviceCharge: number;
  serviceChargeWaived: boolean;
  subtotal: number;
  tax: number;
  total: number;
}

export interface CheckDetail extends CheckSummary {
  customerId: string | null;
  notes: string | null;
  serviceChargeWaiveReason: string | null;
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

/**
 * Removes a line or `quantity` of its units. Items already sent to the kitchen need a reason
 * and a manager, or anyone with the admin PIN (`adminPin`); they are recorded as waste.
 */
export async function voidCheckLine(id: string, lineId: string, input: { restaurantId: string; expectedVersion?: number; reason?: string | null; quantity?: number; adminPin?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/lines/${lineId}/void`, { body: input });
  return data;
}

export async function sendCheck(id: string, input: { restaurantId: string; expectedVersion?: number }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/send`, { body: input });
  return data;
}

export async function voidCheck(id: string, input: { restaurantId: string; expectedVersion?: number; reason?: string | null; adminPin?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/void`, { body: input });
  return data;
}

export async function moveCheck(id: string, input: { restaurantId: string; expectedVersion?: number; tableId: string }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/move`, { body: input });
  return data;
}

/** Merges `fromCheckId` into check `id`. */
export async function mergeChecks(id: string, input: { restaurantId: string; expectedVersion?: number; fromCheckId: string }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/merge`, { body: input });
  return data;
}

/** The guest bill before payment (not a tax invoice); the table shows "billing". */
export async function prebillCheck(id: string, input: { restaurantId: string; expectedVersion?: number }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/prebill`, { body: input });
  return data;
}

/** Waives (manager or admin PIN, with a reason) or restores the service charge. */
export async function setCheckServiceCharge(id: string, input: { restaurantId: string; expectedVersion?: number; waived: boolean; reason?: string | null; adminPin?: string | null }) {
  const { data } = await apiRequest<CheckDetail>(`/pos/checks/${id}/service-charge`, { body: input });
  return data;
}

export interface ChecksReport {
  day: string;
  open: { count: number; total: number; checks: CheckSummary[] };
  paid: { checks: number; sales: number; serviceCharge: number };
  voids: {
    count: number;
    value: number;
    wasteCost: number;
    items: { checkNumber: string; name: string; quantity: number; reason: string | null; approval: string | null; voidedBy: string | null; voidedAt: string; value: number; wasteCost: number }[];
  };
}

/** Owners and managers: open checks, paid checks, service charge, voids and waste of a day. */
export async function checksReport(restaurantId: string, opts: { branchId?: string | null; day?: string | null } = {}) {
  const q = new URLSearchParams({ restaurantId, ...(opts.branchId ? { branchId: opts.branchId } : {}), ...(opts.day ? { day: opts.day } : {}) });
  const { data } = await apiRequest<ChecksReport>(`/pos/checks/report?${q}`);
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
