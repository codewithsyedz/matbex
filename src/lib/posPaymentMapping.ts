import { db } from "@/integrations/db/client";

export type PaymentBucket = "cash" | "card" | "delivery" | "other";

export type RuleMatchType = "exact" | "prefix" | "suffix" | "contains" | "regex";

export interface PaymentRule {
  id?: string;
  pattern: string;
  match_type: RuleMatchType;
  bucket: PaymentBucket;
  priority: number;
}

const DEFAULTS: Record<string, PaymentBucket> = {
  cash: "cash",
  card: "card",
  credit: "card",
  debit: "card",
  visa: "card",
  mastercard: "card",
  mada: "card",
  apple_pay: "card",
  applepay: "card",
  delivery: "delivery",
  hungerstation: "delivery",
  jahez: "delivery",
  toyou: "delivery",
  mrsool: "delivery",
  carriage: "delivery",
  talabat: "delivery",
  uber_eats: "delivery",
  ubereats: "delivery",
  other: "other",
};

export function ruleMatches(pm: string, rule: PaymentRule): boolean {
  const k = pm.trim().toLowerCase();
  const p = rule.pattern.trim().toLowerCase();
  if (!k || !p) return false;
  switch (rule.match_type) {
    case "exact":
      return k === p;
    case "prefix":
      return k.startsWith(p);
    case "suffix":
      return k.endsWith(p);
    case "contains":
      return k.includes(p);
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(pm);
      } catch {
        return false;
      }
  }
}

export function bucketForPaymentMethod(
  pm: string | null | undefined,
  overrides: Record<string, PaymentBucket>,
  rules: PaymentRule[] = [],
): PaymentBucket {
  const key = String(pm || "").trim().toLowerCase();
  if (!key) return "other";
  // 1. Explicit per-method override
  if (overrides[key]) return overrides[key];
  // 2. User-defined rules (sorted by priority asc - lower runs first)
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(key, r)) return r.bucket;
  }
  // 3. Built-in defaults
  if (DEFAULTS[key]) return DEFAULTS[key];
  return "other";
}

export type SuggestionSource =
  | "override"
  | "rule"
  | "default"
  | "similarity"
  | "fallback";

export interface BucketSuggestion {
  bucket: PaymentBucket;
  source: SuggestionSource;
  reason: string;
  detail?: string;
}

/** Levenshtein distance for similarity matching */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Explain how a bucket was chosen for a POS payment method. Used to surface
 * "why" each suggestion was made in the review UI.
 */
export function suggestBucket(
  pm: string | null | undefined,
  overrides: Record<string, PaymentBucket>,
  rules: PaymentRule[] = [],
): BucketSuggestion {
  const key = String(pm || "").trim().toLowerCase();
  if (!key) {
    return { bucket: "other", source: "fallback", reason: "Empty value" };
  }

  // 1. Explicit per-method override (last known mapping)
  if (overrides[key]) {
    return {
      bucket: overrides[key],
      source: "override",
      reason: "Last saved mapping",
    };
  }

  // 2. User-defined rules
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(key, r)) {
      return {
        bucket: r.bucket,
        source: "rule",
        reason: `Rule: ${r.match_type} "${r.pattern}"`,
        detail: `priority ${r.priority}`,
      };
    }
  }

  // 3. Built-in defaults - exact key match
  if (DEFAULTS[key]) {
    return {
      bucket: DEFAULTS[key],
      source: "default",
      reason: `Built-in default for "${key}"`,
    };
  }

  // 4. Similarity to a known default (substring or close edit distance)
  let best: { name: string; bucket: PaymentBucket; score: number } | null = null;
  for (const [name, bucket] of Object.entries(DEFAULTS)) {
    let score = Infinity;
    if (key.includes(name) || name.includes(key)) {
      score = -name.length; // prefer longer substring matches
    } else {
      const d = editDistance(key, name);
      const maxLen = Math.max(key.length, name.length);
      // only consider close matches (≤25% of length, min length 3)
      if (name.length >= 3 && key.length >= 3 && d <= Math.max(1, Math.floor(maxLen * 0.25))) {
        score = d;
      }
    }
    if (score !== Infinity && (best === null || score < best.score)) {
      best = { name, bucket, score };
    }
  }
  if (best) {
    return {
      bucket: best.bucket,
      source: "similarity",
      reason: `Looks similar to "${best.name}"`,
    };
  }

  return {
    bucket: "other",
    source: "fallback",
    reason: "No match - defaulting to Other",
  };
}

export async function fetchPaymentMap(
  restaurantId: string,
): Promise<Record<string, PaymentBucket>> {
  const { data, error } = await db
    .from("pos_payment_method_map")
    .select("payment_method,bucket")
    .eq("restaurant_id", restaurantId);
  if (error) throw error;
  const out: Record<string, PaymentBucket> = {};
  for (const r of data || []) {
    const k = String((r as { payment_method: string }).payment_method || "")
      .trim()
      .toLowerCase();
    if (k) out[k] = (r as { bucket: PaymentBucket }).bucket;
  }
  return out;
}

export async function savePaymentMap(
  restaurantId: string,
  tenantId: string,
  map: Record<string, PaymentBucket>,
) {
  // Snapshot existing rows so we can compute a diff for audit logging
  const { data: existingRows } = await db
    .from("pos_payment_method_map")
    .select("payment_method,bucket")
    .eq("restaurant_id", restaurantId);
  const before: Record<string, PaymentBucket> = {};
  for (const r of existingRows || []) {
    const k = String((r as { payment_method: string }).payment_method || "")
      .trim()
      .toLowerCase();
    if (k) before[k] = (r as { bucket: PaymentBucket }).bucket;
  }

  // Upsert all current entries
  const rows = Object.entries(map).map(([payment_method, bucket]) => ({
    tenant_id: tenantId,
    restaurant_id: restaurantId,
    payment_method: payment_method.trim().toLowerCase(),
    bucket,
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("pos_payment_method_map")
      .upsert(rows, { onConflict: "restaurant_id,payment_method" });
    if (error) throw error;
  }

  // Remove rows that are no longer in the map
  const keep = rows.map((r) => r.payment_method);
  let del = db
    .from("pos_payment_method_map")
    .delete()
    .eq("restaurant_id", restaurantId);
  if (keep.length > 0) {
    del = del.not("payment_method", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  }
  const { error: delErr } = await del;
  if (delErr) throw delErr;

  // Build and insert audit entries
  const { data: userData } = await db.auth.getUser();
  const uid = userData.user?.id ?? null;
  const audit: Array<{
    tenant_id: string;
    restaurant_id: string;
    payment_method: string;
    from_bucket: PaymentBucket | null;
    to_bucket: PaymentBucket | null;
    action: "create" | "update" | "delete";
    changed_by: string | null;
  }> = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(map)]);
  for (const k of allKeys) {
    const from = before[k] ?? null;
    const to = map[k] ?? null;
    if (from === to) continue;
    audit.push({
      tenant_id: tenantId,
      restaurant_id: restaurantId,
      payment_method: k,
      from_bucket: from,
      to_bucket: to,
      action: !from ? "create" : !to ? "delete" : "update",
      changed_by: uid,
    });
  }
  if (audit.length > 0 && uid) {
    await db.from("pos_payment_method_audit").insert(audit);
  }
}

export interface PaymentMappingAuditEntry {
  id: string;
  payment_method: string;
  from_bucket: PaymentBucket | null;
  to_bucket: PaymentBucket | null;
  action: "create" | "update" | "delete";
  changed_by: string | null;
  changed_at: string;
}

export async function fetchPaymentMappingAudit(
  restaurantId: string,
  limit = 100,
): Promise<PaymentMappingAuditEntry[]> {
  const { data, error } = await db
    .from("pos_payment_method_audit")
    .select("id,payment_method,from_bucket,to_bucket,action,changed_by,changed_at")
    .eq("restaurant_id", restaurantId)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PaymentMappingAuditEntry[];
}

export async function fetchPaymentRules(restaurantId: string): Promise<PaymentRule[]> {
  const { data, error } = await db
    .from("pos_payment_method_rules")
    .select("id,pattern,match_type,bucket,priority")
    .eq("restaurant_id", restaurantId)
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data || []) as PaymentRule[];
}

export async function savePaymentRules(
  restaurantId: string,
  tenantId: string,
  rules: PaymentRule[],
) {
  // Replace all rules for this restaurant
  const { error: delErr } = await db
    .from("pos_payment_method_rules")
    .delete()
    .eq("restaurant_id", restaurantId);
  if (delErr) throw delErr;

  if (rules.length === 0) return;

  const rows = rules.map((r, i) => ({
    tenant_id: tenantId,
    restaurant_id: restaurantId,
    pattern: r.pattern.trim(),
    match_type: r.match_type,
    bucket: r.bucket,
    priority: r.priority ?? i * 10,
  }));
  const { error } = await db.from("pos_payment_method_rules").insert(rows);
  if (error) throw error;
}
