import { describe, it, expect } from "vitest";
import { canonicalize, computeChecksum, verifyChecksum } from "../checksum";

describe("canonicalize", () => {
  it("sorts object keys deterministically at every depth", () => {
    const a = { b: 1, a: 2, nested: { z: 9, y: 8 } };
    const b = { nested: { y: 8, z: 9 }, a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined values", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("computeChecksum", () => {
  it("is stable for equivalent payloads", async () => {
    const p1 = { total: 100, items: [{ id: "x", qty: 2 }] };
    const p2 = { items: [{ qty: 2, id: "x" }], total: 100 };
    expect(await computeChecksum(p1)).toBe(await computeChecksum(p2));
  });

  it("changes when the payload changes", async () => {
    const a = await computeChecksum({ total: 100 });
    const b = await computeChecksum({ total: 101 });
    expect(a).not.toBe(b);
  });

  it("verifyChecksum round-trips", async () => {
    const payload = { hello: "world", nested: [1, 2, 3] };
    const sum = await computeChecksum(payload);
    expect(await verifyChecksum(payload, sum)).toBe(true);
    expect(await verifyChecksum({ ...payload, hello: "mars" }, sum)).toBe(false);
  });
});