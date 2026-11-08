import { format } from "date-fns";

const HEADERS = [
  "item_name",
  "direction",            // 'add' or 'remove'
  "quantity",             // in stock units
  "reason_code",          // stocktake_correction | damaged | expired | theft_loss | transfer_in | transfer_out | opening_balance | other
  "reference_number",     // optional
  "notes",                // optional
];

const EXAMPLE_ROWS: string[][] = [
  ["Milk (1L)", "add", "12", "stocktake_correction", "STK-2026-04", "Found extra after recount"],
  ["Chicken Breast", "remove", "2.5", "damaged", "INC-220", "Spoiled batch - discarded"],
  ["Cooking Oil", "add", "20", "opening_balance", "OPEN-Apr", "Opening balance for April"],
];

function toCsvCell(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateStockAdjustmentTemplateCsv(): string {
  const lines = [
    HEADERS.join(","),
    ...EXAMPLE_ROWS.map((row) => row.map(toCsvCell).join(",")),
  ];
  return lines.join("\n");
}

export function downloadStockAdjustmentTemplate() {
  const csv = generateStockAdjustmentTemplateCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `stock_adjustment_template_${format(new Date(), "yyyy-MM-dd")}.csv`,
  );
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}