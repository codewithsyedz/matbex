/**
 * ZATCA invoice records on a sale:
 *   POST /api/v1/zatca/sales/:id/chain       allocate ICV/PIH on a device and stamp the sale (once)
 *   POST /api/v1/zatca/sales/:id/documents   freeze the QR/VAT snapshot, PDF and XML links (once each)
 */
const uuid = { type: "string", format: "uuid" } as const;
const url = { type: "string", maxLength: 2000 } as const;

export const idParams = { type: "object", required: ["id"], properties: { id: uuid } } as const;

export const chainBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "deviceId", "sellerName", "vatNumber", "timestamp"],
  properties: {
    restaurantId: uuid,
    deviceId: uuid,
    sellerName: { type: "string", minLength: 1, maxLength: 300 },
    vatNumber: { type: "string", minLength: 1, maxLength: 30 },
    /** Invoice issue time printed on the receipt (ISO 8601). */
    timestamp: { type: "string", format: "date-time" },
  },
} as const;
export interface ChainInput {
  restaurantId: string;
  deviceId: string;
  sellerName: string;
  vatNumber: string;
  timestamp: string;
}

export const documentsBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  minProperties: 2,
  properties: {
    restaurantId: uuid,
    snapshot: {
      type: "object",
      additionalProperties: true,
      required: ["sellerName", "vatNumber", "timestamp", "invoiceTotal", "vatTotal"],
      properties: {
        sellerName: { type: "string", maxLength: 300 },
        sellerNameAr: { type: "string", maxLength: 300, nullable: true },
        vatNumber: { type: "string", maxLength: 30 },
        timestamp: { type: "string", format: "date-time" },
        invoiceTotal: { type: ["string", "number"] },
        vatTotal: { type: ["string", "number"] },
        qrBase64: { type: "string", maxLength: 4000, nullable: true },
      },
    },
    pdfUrl: { ...url, nullable: true },
    xmlUrl: { ...url, nullable: true },
  },
} as const;
export interface DocumentsInput {
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
}
