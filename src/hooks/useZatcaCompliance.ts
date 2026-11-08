import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

export interface ZatcaComplianceMetrics {
  total: number;
  pending: number;
  cleared: number;
  reported: number;
  rejected: number;
  schemaInvalid: number;
  successRate: number; // 0..1
  avgLatencyMs: number | null;
  last24h: { day: string; cleared: number; failed: number }[];
}

interface SaleRow {
  id: string;
  created_at: string;
  zatca_clearance_status: string | null;
  zatca_cleared_at: string | null;
  zatca_clearance_response: unknown;
  zatca_invoice_subtype: string | null;
}

/**
 * Aggregate ZATCA clearance KPIs for the active restaurant.
 * Window: last 30 days.
 */
export function useZatcaCompliance() {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const restaurantId = restaurant?.id ?? null;

  return useQuery({
    queryKey: ["zatca", "compliance", restaurantId, branchId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<ZatcaComplianceMetrics> => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      let q = supabase
        .from("sales_transactions")
        .select(
          "id, created_at, zatca_clearance_status, zatca_cleared_at, zatca_clearance_response, zatca_invoice_subtype",
        )
        .eq("restaurant_id", restaurantId!)
        .not("zatca_clearance_status", "is", null)
        .gte("created_at", since)
        .limit(2000);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as SaleRow[];

      let pending = 0, cleared = 0, reported = 0, rejected = 0, schemaInvalid = 0;
      let latencySum = 0, latencyCount = 0;
      const dayMap = new Map<string, { cleared: number; failed: number }>();

      for (const r of rows) {
        const s = r.zatca_clearance_status;
        if (s === "PENDING") pending++;
        else if (s === "CLEARED" || s === "CLEARED_SIM") cleared++;
        else if (s === "REPORTED") reported++;
        else if (s === "REJECTED") rejected++;
        else if (s === "SCHEMA_INVALID") schemaInvalid++;

        if (r.zatca_cleared_at && r.created_at) {
          const dt = new Date(r.zatca_cleared_at).getTime() - new Date(r.created_at).getTime();
          if (dt >= 0 && dt < 1000 * 3600 * 24) {
            latencySum += dt;
            latencyCount++;
          }
        }

        const day = r.created_at.slice(0, 10);
        const bucket = dayMap.get(day) ?? { cleared: 0, failed: 0 };
        if (s === "CLEARED" || s === "REPORTED" || s === "CLEARED_SIM") bucket.cleared++;
        else if (s === "REJECTED" || s === "SCHEMA_INVALID") bucket.failed++;
        dayMap.set(day, bucket);
      }

      const successful = cleared + reported;
      const finalized = successful + rejected + schemaInvalid;
      const successRate = finalized > 0 ? successful / finalized : 1;

      const last24h = Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([day, v]) => ({ day, ...v }));

      return {
        total: rows.length,
        pending,
        cleared,
        reported,
        rejected,
        schemaInvalid,
        successRate,
        avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
        last24h,
      };
    },
  });
}

export interface ZatcaAuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  prev_hash: string | null;
  created_at: string;
}

export interface AuditFilters {
  entityTypes?: string[];
  actions?: string[];
  search?: string;
  fromDate?: string; // ISO
  toDate?: string;   // ISO (exclusive upper bound recommended)
}

export function useZatcaAuditTrail(limit = 100, filters: AuditFilters = {}) {
  const { restaurant, tenant } = useAuth();
  const tenantId = tenant?.id ?? restaurant?.tenant_id ?? null;
  const { entityTypes, actions, search, fromDate, toDate } = filters;
  return useQuery({
    queryKey: ["zatca", "audit", tenantId, limit, entityTypes, actions, search, fromDate, toDate],
    enabled: !!tenantId,
    queryFn: async (): Promise<ZatcaAuditRow[]> => {
      let q = supabase
        .from("zatca_audit_trail" as never)
        .select("id, entity_type, entity_id, action, actor_user_id, payload, payload_hash, prev_hash, sequence_no, created_at")
        .eq("tenant_id", tenantId!);
      if (entityTypes && entityTypes.length) q = q.in("entity_type", entityTypes);
      if (actions && actions.length) q = q.in("action", actions);
      if (fromDate) q = q.gte("created_at", fromDate);
      if (toDate) q = q.lte("created_at", toDate);
      if (search && search.trim()) {
        const s = search.trim();
        const uuidLike = /^[0-9a-f-]{8,36}$/i.test(s);
        const parts = [
          `payload_hash.ilike.%${s}%`,
          `prev_hash.ilike.%${s}%`,
        ];
        if (uuidLike && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
          parts.push(`entity_id.eq.${s}`);
        }
        q = q.or(parts.join(","));
      }
      const { data, error } = await q
        .order("sequence_no", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ZatcaAuditRow[];
    },
  });
}

export interface ChainIntegrityResult {
  intact: boolean;
  brokenRow: string | null;
  brokenSeq: number | null;
  totalRows: number;
}

/**
 * Verify the tamper-evident hash chain for the active tenant by re-walking
 * every audit row server-side. Returns the first row that fails verification,
 * or `intact: true` if the entire chain validates.
 */
export function useZatcaChainIntegrity() {
  const { restaurant, tenant } = useAuth();
  const tenantId = tenant?.id ?? restaurant?.tenant_id ?? null;
  return useQuery({
    queryKey: ["zatca", "chain-integrity", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<ChainIntegrityResult> => {
      const { data, error } = await supabase.rpc(
        "verify_zatca_audit_chain" as never,
        { _tenant_id: tenantId! } as never,
      );
      if (error) throw error;
      const arr = (data ?? []) as Array<Record<string, unknown>>;
      const row = arr[0];
      const brokenRow = (row?.broken_row as string | null) ?? null;
      const brokenSeq = (row?.broken_seq as number | null) ?? null;
      const totalRows = Number(row?.total_rows ?? 0);
      return { intact: !brokenRow, brokenRow, brokenSeq, totalRows };
    },
  });
}

export interface ChainBreakDetail {
  brokenRow: string;
  brokenSeq: number;
  entityType: string;
  entityId: string | null;
  action: string;
  createdAt: string;
  storedHash: string;
  expectedHash: string;
  storedPrevHash: string;
  expectedPrevHash: string;
  payload: unknown;
  prevPayload: unknown;
  reason: string;
}

/**
 * Diagnostic detail for the first tampered row in the audit chain.
 * Returns null when the chain is intact.
 */
export function useZatcaChainBreakDetail(enabled: boolean) {
  const { restaurant, tenant } = useAuth();
  const tenantId = tenant?.id ?? restaurant?.tenant_id ?? null;
  return useQuery({
    queryKey: ["zatca", "chain-break-detail", tenantId],
    enabled: enabled && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<ChainBreakDetail | null> => {
      const { data, error } = await supabase.rpc(
        "inspect_zatca_audit_break" as never,
        { _tenant_id: tenantId! } as never,
      );
      if (error) throw error;
      const arr = (data ?? []) as Array<Record<string, unknown>>;
      const row = arr[0];
      if (!row || !row.broken_row) return null;
      return {
        brokenRow: row.broken_row as string,
        brokenSeq: Number(row.broken_seq),
        entityType: (row.entity_type as string) ?? "",
        entityId: (row.entity_id as string | null) ?? null,
        action: (row.action as string) ?? "",
        createdAt: (row.created_at as string) ?? "",
        storedHash: (row.stored_hash as string) ?? "",
        expectedHash: (row.expected_hash as string) ?? "",
        storedPrevHash: (row.stored_prev_hash as string) ?? "",
        expectedPrevHash: (row.expected_prev_hash as string) ?? "",
        payload: row.payload,
        prevPayload: row.prev_payload,
        reason: (row.reason as string) ?? "",
      };
    },
  });
}
