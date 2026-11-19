/**
 * ZATCA records on a sale, written by the server so they cannot be edited from a browser.
 *
 * chain: allocates the device's next ICV/PIH (next_zatca_chain) and stamps the sale with the
 * device, UUID, ICV, PIH and invoice hash IN THE SAME TRANSACTION. The browser used to do this
 * in two calls, so a failure in between used up an ICV no invoice carried (a gap in the
 * device's chain). Idempotent: a sale that already has a UUID gets its existing values back.
 * The invoice hash is computed here from the stored sale and its lines (same canonical form
 * as src/lib/zatca/chain.ts), not from the cart.
 *
 * documents: freezes the receipt snapshot (seller, VAT number, totals, QR) and the PDF/XML
 * links. Each is written once; storage links must point at this restaurant's folder.
 */
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import type { ChainInput, DocumentsInput } from "./zatca.schema.js";

type Claims = DbClaims & { sub: string };
const ROLES = ["owner", "manager", "cashier", "waiter", "accountant"] as const;
const conflict = (m: string, c: string) => new HttpError(409, m, c);

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${sortedStringify(o[k])}`).join(",")}}`;
}

export async function stampChain(saleId: string, input: ChainInput, claims: Claims) {
  return inServiceTx(claims, async ({ tx }) => {
    await requireRestaurantRole(tx, claims.sub, input.restaurantId, [...ROLES]);
    const [sale] = await tx<{ id: string; receipt_number: string | null; subtotal: number; tax: number; total: number; payment_method: string; voided_at: string | null; voids_transaction_id: string | null; zatca_uuid: string | null; zatca_icv: number | null; zatca_pih: string | null; zatca_invoice_hash: string | null; zatca_device_id: string | null }[]>`
      select id, receipt_number, subtotal::float8 as subtotal, tax::float8 as tax, total::float8 as total,
             payment_method::text as payment_method, voided_at, voids_transaction_id,
             zatca_uuid, zatca_icv, zatca_pih, zatca_invoice_hash, zatca_device_id
      from public.sales_transactions where id = ${saleId} and restaurant_id = ${input.restaurantId} for update`;
    if (!sale) throw new HttpError(404, "Sale not found", "sale_not_found");
    if (sale.zatca_uuid) {
      return { uuid: sale.zatca_uuid, icv: Number(sale.zatca_icv), pih: sale.zatca_pih, invoiceHash: sale.zatca_invoice_hash, deviceId: sale.zatca_device_id, replayed: true };
    }
    if (sale.voided_at || sale.voids_transaction_id) throw conflict("Voided sales and void entries get no invoice number", "voided");

    const [device] = await tx<{ id: string; registration_status: string | null }[]>`
      select id, registration_status from public.zatca_devices where id = ${input.deviceId} and restaurant_id = ${input.restaurantId}`;
    if (!device) throw new HttpError(404, "ZATCA device not found for this restaurant", "device_not_found");
    if (device.registration_status === "REVOKED") throw conflict("This ZATCA device is revoked", "device_revoked");

    const items = await tx<{ n: string; q: number; u: number; t: number }[]>`
      select coalesce(mi.name, 'Item') as n, si.quantity as q, si.unit_price::float8 as u, si.total_price::float8 as t
      from public.sales_items si left join public.menu_items mi on mi.id = si.menu_item_id
      where si.transaction_id = ${sale.id} order by si.created_at, si.id`;
    const uuid = randomUUID();
    const canonical = sortedStringify({
      uuid, receipt: sale.receipt_number, seller: input.sellerName, vat: input.vatNumber, ts: input.timestamp,
      sub: sale.subtotal.toFixed(2), tax: sale.tax.toFixed(2), total: sale.total.toFixed(2), pm: sale.payment_method,
      items: items.map((i) => ({ n: i.n, q: i.q, u: i.u.toFixed(2), t: i.t.toFixed(2) })),
    });
    const invoiceHash = createHash("sha256").update(canonical).digest("base64");

    const [chain] = await tx<{ icv: number; pih: string }[]>`select icv::int as icv, pih from public.next_zatca_chain(${device.id}::uuid, ${invoiceHash})`;
    await tx`
      update public.sales_transactions
         set zatca_device_id = ${device.id}, zatca_uuid = ${uuid}, zatca_icv = ${chain.icv}, zatca_pih = ${chain.pih},
             zatca_invoice_hash = ${invoiceHash}, zatca_clearance_status = 'PENDING'
       where id = ${sale.id}`;
    return { uuid, icv: chain.icv, pih: chain.pih, invoiceHash, deviceId: device.id, replayed: false };
  });
}

/** A signed URL from this API's storage, in the given bucket, under the restaurant's folder. */
function assertOwnLink(link: string, bucket: string, restaurantId: string) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(link).pathname);
  } catch {
    throw new HttpError(400, "Not a valid URL", "invalid_url");
  }
  if (!new RegExp(`/storage/v1/object/(sign|public|authenticated)/${bucket}/${restaurantId}/`).test(path)) {
    throw new HttpError(400, `Link must point at this restaurant's ${bucket} folder`, "foreign_link");
  }
}

export async function recordDocuments(saleId: string, input: DocumentsInput, claims: Claims) {
  if (input.pdfUrl) assertOwnLink(input.pdfUrl, "zatca-receipts", input.restaurantId);
  if (input.xmlUrl) assertOwnLink(input.xmlUrl, "zatca-xml", input.restaurantId);
  return inServiceTx(claims, async ({ tx }) => {
    await requireRestaurantRole(tx, claims.sub, input.restaurantId, [...ROLES]);
    const [sale] = await tx<{ id: string; zatca_generated_at: string | null; zatca_pdf_url: string | null; zatca_xml_url: string | null }[]>`
      select id, zatca_generated_at, zatca_pdf_url, zatca_xml_url
      from public.sales_transactions where id = ${saleId} and restaurant_id = ${input.restaurantId} for update`;
    if (!sale) throw new HttpError(404, "Sale not found", "sale_not_found");

    const written: string[] = [];
    if (input.snapshot && !sale.zatca_generated_at) {
      const s = input.snapshot;
      await tx`
        update public.sales_transactions
           set zatca_seller_name = ${s.sellerName}, zatca_seller_name_ar = ${s.sellerNameAr ?? null},
               zatca_vat_number = ${s.vatNumber}, zatca_qr_base64 = ${s.qrBase64 ?? null},
               zatca_invoice_total = ${Number(s.invoiceTotal)}, zatca_vat_total = ${Number(s.vatTotal)},
               zatca_timestamp = ${s.timestamp}, zatca_generated_at = now()
         where id = ${sale.id}`;
      written.push("snapshot");
    }
    if (input.pdfUrl && !sale.zatca_pdf_url) {
      await tx`update public.sales_transactions set zatca_pdf_url = ${input.pdfUrl} where id = ${sale.id}`;
      written.push("pdf");
    }
    if (input.xmlUrl && !sale.zatca_xml_url) {
      await tx`update public.sales_transactions set zatca_xml_url = ${input.xmlUrl} where id = ${sale.id}`;
      written.push("xml");
    }
    return { written };
  });
}
