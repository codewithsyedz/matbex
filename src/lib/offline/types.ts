// Shared offline-record types for the POS offline layer.

export type OfflineStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "FAILED_VALIDATION";
export type EntityType = "ORDER" | "PAYMENT" | "INVOICE" | "RETURN" | "CASH_DRAWER";
export type Operation = "CREATE" | "UPDATE" | "VOID" | "REFUND";

/**
 * Version vector — { device_id, monotonic lamport counter }.
 * Server uses the pair to detect concurrent writes across devices.
 * See docs/architecture/offline-first-pos.md §9.
 */
export interface VersionVector {
  device: string;
  lamport: number;
}

export interface OfflineRecord<TPayload = unknown> {
  local_id: string;
  server_id: string | null;
  branch_id: string;       // restaurant_id
  cashier_id: string;
  terminal_id: string;
  business_date: string;   // YYYY-MM-DD
  payload: TPayload;       // may be encrypted blob -> see crypto.ts
  status: OfflineStatus;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  /**
   * Optional for back-compat with rows written before Phase 2. All new writes
   * (via posService) stamp both fields; the sync engine treats a missing
   * version/checksum as "legacy row" and forwards it as-is.
   */
  version?: VersionVector;
  checksum?: string;
}

export interface SyncQueueItem {
  queue_id: string;
  entity_type: EntityType;
  entity_local_id: string;
  operation: Operation;
  idempotency_key: string;
  dependency_key: string | null;
  status: OfflineStatus;
  retry_count: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SyncLog {
  id?: number;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

export type ConnectivityStatus = "online" | "offline" | "syncing" | "sync-failed";