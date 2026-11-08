export interface ZatcaQrData {
  sellerName?: string;
  vatNumber?: string;
  timestamp?: string;
  total?: number;
  vat?: number;
}

/** Decode a ZATCA Phase 1/2 QR payload (base64 TLV: 1 seller, 2 VAT no, 3 time, 4 total incl. VAT, 5 VAT). */
export function parseZatcaQr(input: string): ZatcaQrData | null {
  const clean = input.trim().replace(/\s+/g, "");
  if (!clean) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(clean);
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const decoder = new TextDecoder();
  const out: ZatcaQrData = {};
  let i = 0;
  while (i + 2 <= bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    const value = bytes.slice(i + 2, i + 2 + len);
    if (value.length < len) break;
    const text = decoder.decode(value);
    if (tag === 1) out.sellerName = text;
    else if (tag === 2) out.vatNumber = text;
    else if (tag === 3) out.timestamp = text;
    else if (tag === 4) out.total = Number(text);
    else if (tag === 5) out.vat = Number(text);
    i += 2 + len;
  }
  return out.vatNumber || out.total !== undefined ? out : null;
}
