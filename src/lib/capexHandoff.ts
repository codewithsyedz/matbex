/**
 * Hand-off between the expense form and the Fixed Asset Register.
 *
 * When the posting guard blocks an expense that was charged to a fixed asset
 * account, the user can jump straight to the register. We stash the half-typed
 * expense here so the register can prefill the purchase, and stash the outcome
 * so the expense form knows what happened when the user comes back.
 */

const KEY = "matbex.capex-handoff";
/** Handoffs older than this are ignored (stale context is worse than none). */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Query param used so a shared/reloaded URL lands on the same handoff. */
export const CAPEX_HANDOFF_PARAM = "capex";
export const CAPEX_HANDOFF_EVENT = "capex-handoff-change";

export interface CapexHandoffDraft {
  description?: string | null;
  amount?: string | null;
  expenseDate?: string | null;
  supplierName?: string | null;
  branchId?: string | null;
  categoryId?: string | null;
  vatRatePercent?: string | null;
  vatInclusive?: boolean;
  accountId?: string | null;
  accountLabel?: string | null;
  supplierId?: string | null;
  paymentMethod?: string | null;
  status?: "paid" | "unpaid" | null;
  /** Account picked to fund the expense (company / owner / partner dialog). */
  fundingSource?: string | null;
  paymentAccountId?: string | null;
  capitalAccountId?: string | null;
}

export interface CapexHandoffResolution {
  /** capitalized = asset created; expensed = below threshold; referenced = linked to an existing project/CIP. */
  kind: "capitalized" | "expensed" | "referenced";
  assetId?: string | null;
  assetName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  amount?: number | null;
  at: string;
}

export interface CapexHandoff {
  id: string;
  createdAt: string;
  updatedAt?: string;
  returnPath: string;
  draft: CapexHandoffDraft;
  /** Project / CIP / ACQ entry already linked, so the guard stays cleared. */
  link?: { projectId: string; projectName: string } | null;
  status: "pending" | "resolved";
  resolution?: CapexHandoffResolution;
}

const notify = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CAPEX_HANDOFF_EVENT));
  }
};

const write = (value: CapexHandoff | null) => {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      const payload = JSON.stringify({ ...value, updatedAt: new Date().toISOString() });
      window.localStorage.setItem(KEY, payload);
      window.sessionStorage.setItem(KEY, payload);
    } else {
      window.localStorage.removeItem(KEY);
      window.sessionStorage.removeItem(KEY);
    }
  } catch {
    /* storage disabled — the flow degrades to a plain navigation */
  }
  notify();
};

export function readCapexHandoff(): CapexHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(KEY) ?? window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapexHandoff;
    if (!parsed || !parsed.id) return null;
    const stamp = Date.parse(parsed.updatedAt ?? parsed.createdAt);
    if (Number.isFinite(stamp) && Date.now() - stamp > TTL_MS) {
      window.localStorage.removeItem(KEY);
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function startCapexHandoff(draft: CapexHandoffDraft, returnPath: string): CapexHandoff {
  const current = readCapexHandoff();
  const handoff: CapexHandoff = {
    id: current?.status === "pending" ? current.id : `capex-${Date.now()}`,
    createdAt: new Date().toISOString(),
    returnPath,
    draft,
    link: current?.link ?? null,
    status: "pending",
  };
  write(handoff);
  return handoff;
}

/**
 * Keeps the stored draft in sync while the user is still on the expense form,
 * so navigating away (even without pressing the jump button) loses nothing.
 */
export function persistCapexDraft(
  draft: CapexHandoffDraft,
  returnPath: string,
  link?: { projectId: string; projectName: string } | null,
): CapexHandoff {
  const current = readCapexHandoff();
  if (current?.status === "resolved") return current;
  const handoff: CapexHandoff = {
    id: current?.id ?? `capex-${Date.now()}`,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    returnPath,
    draft: { ...(current?.draft ?? {}), ...draft },
    link: link !== undefined ? link : current?.link ?? null,
    status: "pending",
  };
  write(handoff);
  return handoff;
}

/** Remembers the FA / CIP / ACQ entry the expense is linked to. */
export function setCapexLink(link: { projectId: string; projectName: string } | null) {
  const current = readCapexHandoff();
  if (!current) return null;
  const next: CapexHandoff = { ...current, link };
  write(next);
  return next;
}

export function resolveCapexHandoff(resolution: Omit<CapexHandoffResolution, "at">): CapexHandoff | null {
  const current = readCapexHandoff();
  if (!current) return null;
  const next: CapexHandoff = {
    ...current,
    status: "resolved",
    resolution: { ...resolution, at: new Date().toISOString() },
  };
  write(next);
  return next;
}

export function clearCapexHandoff() {
  write(null);
}

/** Human summary used in banners on both sides of the hand-off. */
export function describeResolution(resolution: CapexHandoffResolution): string {
  switch (resolution.kind) {
    case "capitalized":
      return `"${resolution.assetName ?? "The purchase"}" was capitalised in the Fixed Asset Register — the ledger entry and depreciation schedule are already posted, so this expense no longer needs to be saved.`;
    case "expensed":
      return `"${resolution.assetName ?? "The purchase"}" was below the capitalisation threshold, so the register booked it straight to expense. No further entry is needed here.`;
    case "referenced":
      return `Linked to ${resolution.projectName ?? "a project / CIP cost centre"} — the expense may now be posted to the capital work-in-progress account.`;
  }
}
