import { format } from "date-fns";

interface InventoryItem {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  unit_cost: number;
  vat_percentage: number;
  reorder_level: number | null;
  supplier_id: string | null;
}

export interface InventoryExportData {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
}

export function prepareInventoryExportData(
  items: InventoryItem[],
  currency: string = "SAR"
): InventoryExportData {
  const headers = [
    "Name",
    "Current Stock",
    "Unit",
    "Unit Cost",
    "VAT %",
    "Total Value",
    "Reorder Level",
  ];

  const rows = items.map((item) => {
    const totalValue = item.current_stock * item.unit_cost * (1 + item.vat_percentage / 100);
    return [
      item.name,
      item.current_stock,
      item.unit,
      item.unit_cost.toFixed(2),
      item.vat_percentage,
      totalValue.toFixed(2),
      item.reorder_level ?? "",
    ];
  });

  // Add totals row
  const totalValue = items.reduce(
    (sum, item) => sum + item.current_stock * item.unit_cost * (1 + item.vat_percentage / 100),
    0
  );
  rows.push(["TOTAL", "", "", "", "", totalValue.toFixed(2), ""]);

  return {
    headers,
    rows,
    filename: `Inventory_Items_${format(new Date(), "yyyy-MM-dd")}`,
  };
}

export function exportInventoryToCSV(items: InventoryItem[], currency: string = "SAR") {
  const { headers, rows, filename } = prepareInventoryExportData(items, currency);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((cell) => {
          const str = String(cell);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function generateInventoryTemplate(): string {
  const headers = ["name", "current_stock", "unit", "unit_cost", "vat_percentage", "reorder_level"];
  const exampleRow = ["Chicken Breast", "50", "kg", "25.00", "15", "10"];
  
  return [headers.join(","), exampleRow.join(",")].join("\n");
}

export function downloadInventoryTemplate() {
  const csvContent = generateInventoryTemplate();
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "inventory_import_template.csv");
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export interface ParsedInventoryItem {
  name: string;
  current_stock: number;
  unit: string;
  unit_cost: number;
  vat_percentage: number;
  reorder_level: number | null;
}

export function parseInventoryCSV(csvContent: string): {
  items: ParsedInventoryItem[];
  errors: string[];
} {
  const lines = csvContent.split("\n").filter((line) => line.trim());
  const errors: string[] = [];
  const items: ParsedInventoryItem[] = [];

  if (lines.length < 2) {
    return { items: [], errors: ["CSV file must have a header row and at least one data row"] };
  }

  // Parse header
  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map((h) => h.trim().replace(/"/g, ""));

  const nameIdx = headers.indexOf("name");
  const stockIdx = headers.indexOf("current_stock");
  const unitIdx = headers.indexOf("unit");
  const costIdx = headers.indexOf("unit_cost");
  const vatIdx = headers.indexOf("vat_percentage");
  const reorderIdx = headers.indexOf("reorder_level");

  if (nameIdx === -1) {
    return { items: [], errors: ["CSV must have a 'name' column"] };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parsing (handles quoted values)
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const name = values[nameIdx]?.replace(/"/g, "").trim();
    if (!name) {
      errors.push(`Row ${i + 1}: Missing name`);
      continue;
    }

    const currentStock = stockIdx !== -1 ? parseFloat(values[stockIdx]) || 0 : 0;
    const unit = unitIdx !== -1 ? values[unitIdx]?.replace(/"/g, "").trim() || "unit" : "unit";
    const unitCost = costIdx !== -1 ? parseFloat(values[costIdx]) || 0 : 0;
    const vatPercentage = vatIdx !== -1 ? parseFloat(values[vatIdx]) || 15 : 15;
    const reorderLevel = reorderIdx !== -1 && values[reorderIdx]?.trim() 
      ? parseFloat(values[reorderIdx]) 
      : null;

    items.push({
      name,
      current_stock: currentStock,
      unit,
      unit_cost: unitCost,
      vat_percentage: vatPercentage,
      reorder_level: reorderLevel,
    });
  }

  return { items, errors };
}
