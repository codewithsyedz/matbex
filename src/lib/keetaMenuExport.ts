/**
 * Keeta delivery menu export.
 * Produces a CSV matching the Keeta bulk menu upload template columns
 * (Shop ID / Item ID / Menu Categories / ... / Purchase limit).
 */

export const KEETA_HEADERS = [
  "***",
  "Shop ID",
  "Item ID",
  "Menu Categories",
  "Item Name (Arabic)",
  "Item Name (English)",
  "Size ID",
  "Size (Arabic)",
  "Size (English)",
  "Delivery Price",
  "Pickup Price",
  "Option Group Name",
  "Chef's recommendation or not",
  '"Add-on Only" or not',
  "Description (Arabic)",
  "Description (English)",
  "Dine-in Price",
  "Selling Time",
  "Calories(kcal)",
  "Additional nutritional information",
  "Allergen information",
  "Serving size",
  "Purchase limit",
] as const;

export interface KeetaMenuItemInput {
  name: string;
  nameArabic?: string | null;
  category?: string | null;
  price: number;
  deliveryPrice?: number | null;
  pickupPrice?: number | null;
  dineInPrice?: number | null;
  description?: string | null;
  descriptionArabic?: string | null;
  isRecommended?: boolean;
}

export interface KeetaExportOptions {
  shopId?: string;
  /** Percentage uplift applied to delivery price, e.g. 20 => +20%. */
  deliveryMarkupPercent?: number;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function buildKeetaRows(
  items: KeetaMenuItemInput[],
  options: KeetaExportOptions = {},
): (string | number)[][] {
  const { shopId = "", deliveryMarkupPercent = 0 } = options;
  const uplift = 1 + (Number(deliveryMarkupPercent) || 0) / 100;

  return items.map((item) => {
    const base = Number(item.price) || 0;
    const delivery = round2(item.deliveryPrice ?? base * uplift);
    const pickup = item.pickupPrice != null ? round2(item.pickupPrice) : "";
    const dineIn = item.dineInPrice != null ? round2(item.dineInPrice) : "";
    return [
      "",
      shopId,
      "",
      item.category || "Meal",
      item.nameArabic || "",
      item.name || "",
      "",
      "",
      "",
      delivery,
      pickup,
      "",
      item.isRecommended ? "Yes" : "No",
      "No",
      item.descriptionArabic || "",
      item.description || "",
      dineIn,
      "",
      "",
      "",
      "",
      "",
      "",
    ];
  });
}

function csvEscape(value: string | number): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildKeetaCsv(
  items: KeetaMenuItemInput[],
  options?: KeetaExportOptions,
): string {
  const rows = buildKeetaRows(items, options);
  return [
    KEETA_HEADERS.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
}

export function downloadKeetaCsv(
  items: KeetaMenuItemInput[],
  filename: string,
  options?: KeetaExportOptions,
) {
  // BOM keeps Arabic readable when opened directly in Excel.
  const blob = new Blob(["\uFEFF" + buildKeetaCsv(items, options)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
