import { test } from "node:test";
// Deno test for pos-sync event schema (Epic B2).
// Run with: deno test db/functions/pos-sync/eventSchema_test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert/strict";
import { validateBatch } from "./eventSchema.ts";

test("validateBatch — rejects missing items array", () => {
  const r = validateBatch({});
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors[0].field, "items");
});

test("validateBatch — rejects unknown entity_type", () => {
  const r = validateBatch({
    items: [{ idempotency_key: "abcdefghij", entity_type: "GARBAGE", operation: "CREATE", payload: {} }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.errors.some((e) => e.field === "entity_type"));
});

test("validateBatch — flags missing required payload field", () => {
  const r = validateBatch({
    items: [{ idempotency_key: "abcdefghij", entity_type: "CASH_DRAWER", operation: "CREATE", payload: { amount: 10 } }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.errors.some((e) => e.field === "payload.event_type" || e.field === "payload.shift_id"));
});

test("validateBatch — accepts a valid ORDER + PAYMENT batch", () => {
  const r = validateBatch({
    items: [
      {
        idempotency_key: "order-abcdef",
        entity_type: "ORDER",
        operation: "CREATE",
        payload: { receipt_number: "T-1", subtotal: 10, total: 10 },
      },
      {
        idempotency_key: "pay-abcdef",
        entity_type: "PAYMENT",
        operation: "CREATE",
        payload: { amount: 10, shift_id: "s1" },
        dependency_key: "order-abcdef",
      },
    ],
  });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.items.length, 2);
});