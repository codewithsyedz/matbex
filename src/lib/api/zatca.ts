/** ZATCA records on a sale: /api/v1/zatca/* (server/src/modules/zatca). */
import { apiRequest } from "./http";

export interface ZatcaChain {
  uuid: string;
  icv: number;
  pih: string;
  invoiceHash: string;
  deviceId: string;
  replayed: boolean;
}

/**
 * Allocate the device's next ICV/PIH and stamp the sale in one server transaction (no chain
 * gaps). Calling it again for the same sale returns the same values.
 */
export async function stampZatcaChain(
  saleId: string,
  input: { restaurantId: string; deviceId: string; sellerName: string; vatNumber: string; timestamp: string },
) {
  const { data } = await apiRequest<ZatcaChain>(`/zatca/sales/${saleId}/chain`, { body: input });
  return data;
}

/** Freeze the receipt snapshot and the PDF/XML links on a sale (each written once). */
export async function recordZatcaDocuments(
  saleId: string,
  input: {
    restaurantId: string;
    snapshot?: {
      sellerName: string;
      sellerNameAr?: string | null;
      vatNumber: string;
      timestamp: string;
      invoiceTotal: string | number;
      vatTotal: string | number;
      qrBase64?: string | null;
    };
    pdfUrl?: string | null;
    xmlUrl?: string | null;
  },
) {
  const { data } = await apiRequest<{ written: string[] }>(`/zatca/sales/${saleId}/documents`, { body: input });
  return data;
}
