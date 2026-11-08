// Server-side version-vector guard for POS sync writes.
// Enforces monotonic Lamport clocks per (restaurant, entity_type, entity_id)
// so stale/replayed writes are rejected with a clear structured error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type Admin = ReturnType<typeof createClient>;

export interface VersionEnvelope {
  version?: number;
  checksum?: string;
  entity_id?: string;
}

export interface VersionCheckResult {
  ok: true;
  version: number;
  checksum: string | null;
  previousVersion: number | null;
}

export interface VersionCheckError {
  ok: false;
  status: number;
  code: string;
  message: string;
  serverVersion: number | null;
  serverChecksum: string | null;
  clientVersion: number | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assert the incoming write is newer than the last persisted version for the
 * given entity. Skips silently when the client did not supply a version
 * (legacy client compatibility — we simply do not enforce monotonicity).
 */
export async function assertVersion(
  admin: Admin,
  opts: {
    restaurantId: string;
    entityType: string;
    entityId: string;
    envelope: VersionEnvelope | undefined;
  },
): Promise<VersionCheckResult | VersionCheckError> {
  const clientVersion = num(opts.envelope?.version);
  const clientChecksum = opts.envelope?.checksum ?? null;

  // Read current server version (single-row lookup, unique index).
  const { data: current, error: readErr } = await (admin as any)
    .from("pos_entity_versions")
    .select("version, checksum")
    .eq("restaurant_id", opts.restaurantId)
    .eq("entity_type", opts.entityType)
    .eq("entity_id", opts.entityId)
    .maybeSingle();

  if (readErr) {
    return {
      ok: false,
      status: 500,
      code: "version_lookup_failed",
      message: readErr.message,
      serverVersion: null,
      serverChecksum: null,
      clientVersion,
    };
  }

  const serverVersion = current ? Number(current.version) : null;
  const serverChecksum = current?.checksum ?? null;

  // Legacy client (no version) — allow through and do not touch server row.
  if (clientVersion == null) {
    return { ok: true, version: 0, checksum: clientChecksum, previousVersion: serverVersion };
  }

  // Stale write: incoming version must be strictly greater than server.
  if (serverVersion != null && clientVersion <= serverVersion) {
    // Same version + same checksum = exact retry; treat as no-op success.
    if (clientVersion === serverVersion && clientChecksum && clientChecksum === serverChecksum) {
      return { ok: true, version: serverVersion, checksum: serverChecksum, previousVersion: serverVersion };
    }
    return {
      ok: false,
      status: 409,
      code: "stale_write",
      message:
        `Stale write rejected for ${opts.entityType}:${opts.entityId}. ` +
        `Client version ${clientVersion} is not newer than server version ${serverVersion}. ` +
        `Pull latest state and retry with a higher Lamport clock.`,
      serverVersion,
      serverChecksum,
      clientVersion,
    };
  }

  return { ok: true, version: clientVersion, checksum: clientChecksum, previousVersion: serverVersion };
}

/**
 * Persist the accepted version. Call this AFTER the underlying write
 * (sale/shift/cash-event) succeeded, so we never advance the vector for a
 * failed row.
 */
export async function recordVersion(
  admin: Admin,
  opts: {
    restaurantId: string;
    entityType: string;
    entityId: string;
    version: number;
    checksum: string | null;
    terminalId: string | null;
  },
): Promise<void> {
  if (!opts.version || opts.version <= 0) return; // legacy path
  await (admin as any)
    .from("pos_entity_versions")
    .upsert(
      {
        restaurant_id: opts.restaurantId,
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        version: opts.version,
        checksum: opts.checksum,
        terminal_id: opts.terminalId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,entity_type,entity_id" },
    );
}