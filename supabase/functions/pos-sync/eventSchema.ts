// =====================================================================
// Typed event schema for the pos-sync batch endpoint (Epic B2).
// ---------------------------------------------------------------------
// Deliberately dependency-free: Deno edge functions run without Zod
// by default, so we hand-roll a tiny validator. Each event type has
// a required set of payload fields; unknown fields are allowed and
// forwarded as-is to the entity writer.
// =====================================================================

export type EntityType = "ORDER" | "PAYMENT" | "INVOICE" | "CASH_DRAWER" | "RETURN";
export type Operation = "CREATE" | "UPDATE" | "VOID" | "REFUND";

export interface BatchItem {
  idempotency_key: string;
  entity_type: EntityType;
  operation: Operation;
  payload: Record<string, unknown>;
  dependency_key?: string | null;
}

export interface ValidationError {
  index: number;
  idempotency_key: string | null;
  field: string;
  message: string;
}

const ENTITY_TYPES: EntityType[] = ["ORDER", "PAYMENT", "INVOICE", "CASH_DRAWER", "RETURN"];
const OPERATIONS: Operation[] = ["CREATE", "UPDATE", "VOID", "REFUND"];

/** Required payload fields per entity type. Presence check only. */
const REQUIRED_PAYLOAD_FIELDS: Record<EntityType, string[]> = {
  ORDER: ["receipt_number"],
  PAYMENT: ["amount"],
  INVOICE: [],
  CASH_DRAWER: ["event_type", "amount", "shift_id"],
  RETURN: ["total", "refund_reference"],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a batch payload. Returns the coerced item array on success or a
 * list of field-level errors on failure. Preserves original ordering.
 */
export function validateBatch(input: unknown): {
  ok: true;
  items: BatchItem[];
} | {
  ok: false;
  errors: ValidationError[];
} {
  if (!isPlainObject(input) || !Array.isArray((input as any).items)) {
    return { ok: false, errors: [{ index: -1, idempotency_key: null, field: "items", message: "items[] required" }] };
  }
  const raw = (input as any).items as unknown[];
  const errors: ValidationError[] = [];
  const out: BatchItem[] = [];

  raw.forEach((rawItem, i) => {
    if (!isPlainObject(rawItem)) {
      errors.push({ index: i, idempotency_key: null, field: "item", message: "must be an object" });
      return;
    }
    const key = typeof rawItem.idempotency_key === "string" ? rawItem.idempotency_key : null;
    const type = rawItem.entity_type as EntityType;
    const op = rawItem.operation as Operation;
    const payload = rawItem.payload;

    if (!key || key.length < 8) {
      errors.push({ index: i, idempotency_key: key, field: "idempotency_key", message: "must be a non-empty string (>=8 chars)" });
    }
    if (!ENTITY_TYPES.includes(type)) {
      errors.push({ index: i, idempotency_key: key, field: "entity_type", message: `must be one of ${ENTITY_TYPES.join(", ")}` });
    }
    if (!OPERATIONS.includes(op)) {
      errors.push({ index: i, idempotency_key: key, field: "operation", message: `must be one of ${OPERATIONS.join(", ")}` });
    }
    if (!isPlainObject(payload)) {
      errors.push({ index: i, idempotency_key: key, field: "payload", message: "must be an object" });
    } else if (ENTITY_TYPES.includes(type)) {
      for (const field of REQUIRED_PAYLOAD_FIELDS[type]) {
        if (payload[field] == null) {
          errors.push({ index: i, idempotency_key: key, field: `payload.${field}`, message: "required" });
        }
      }
    }

    if (key && ENTITY_TYPES.includes(type) && OPERATIONS.includes(op) && isPlainObject(payload)) {
      out.push({
        idempotency_key: key,
        entity_type: type,
        operation: op,
        payload,
        dependency_key: typeof rawItem.dependency_key === "string" ? rawItem.dependency_key : null,
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items: out };
}