import { test } from "node:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { assertVersion } from "./versionGuard.ts";

// Minimal mock of the postgrest chain used by assertVersion.
function mockAdmin(row: { version: number; checksum: string | null } | null) {
  const chain: any = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return chain;
}

test("legacy client without version is accepted", async () => {
  const res = await assertVersion(mockAdmin(null), {
    restaurantId: "r1", entityType: "sale", entityId: "s1", envelope: {},
  });
  assertEquals(res.ok, true);
});

test("first write with version is accepted", async () => {
  const res = await assertVersion(mockAdmin(null), {
    restaurantId: "r1", entityType: "sale", entityId: "s1",
    envelope: { version: 5, checksum: "abc" },
  });
  assertEquals(res.ok, true);
  if (res.ok) assertEquals(res.version, 5);
});

test("newer version is accepted", async () => {
  const res = await assertVersion(mockAdmin({ version: 3, checksum: "x" }), {
    restaurantId: "r1", entityType: "sale", entityId: "s1",
    envelope: { version: 4, checksum: "y" },
  });
  assertEquals(res.ok, true);
});

test("stale version is rejected with 409 stale_write", async () => {
  const res = await assertVersion(mockAdmin({ version: 10, checksum: "x" }), {
    restaurantId: "r1", entityType: "sale", entityId: "s1",
    envelope: { version: 7, checksum: "y" },
  });
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.status, 409);
    assertEquals(res.code, "stale_write");
    assertEquals(res.serverVersion, 10);
    assertEquals(res.clientVersion, 7);
  }
});

test("equal version with matching checksum is treated as idempotent retry", async () => {
  const res = await assertVersion(mockAdmin({ version: 4, checksum: "same" }), {
    restaurantId: "r1", entityType: "sale", entityId: "s1",
    envelope: { version: 4, checksum: "same" },
  });
  assertEquals(res.ok, true);
});

test("equal version with different checksum is rejected", async () => {
  const res = await assertVersion(mockAdmin({ version: 4, checksum: "old" }), {
    restaurantId: "r1", entityType: "sale", entityId: "s1",
    envelope: { version: 4, checksum: "new" },
  });
  assertEquals(res.ok, false);
});