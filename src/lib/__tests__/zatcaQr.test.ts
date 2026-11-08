import { describe, expect, it } from "vitest";
import { parseZatcaQr } from "../zatcaQr";

const tlv = (tag: number, v: string) => { const b = new TextEncoder().encode(v); return [tag, b.length, ...b]; };
const encode = (parts: number[]) => btoa(String.fromCharCode(...parts));

describe("parseZatcaQr", () => {
  it("reads seller VAT number, total and VAT", () => {
    const qr = encode([...tlv(1, "مورد"), ...tlv(2, "300000000000003"), ...tlv(3, "2026-11-05T10:00:00Z"), ...tlv(4, "115.00"), ...tlv(5, "15.00")]);
    expect(parseZatcaQr(qr)).toEqual({ sellerName: "مورد", vatNumber: "300000000000003", timestamp: "2026-11-05T10:00:00Z", total: 115, vat: 15 });
  });
  it("rejects garbage", () => {
    expect(parseZatcaQr("not base64 !!")).toBeNull();
  });
});
