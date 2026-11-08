/**
 * Jahez menu export.
 * Produces an .xlsx workbook matching the official Jahez menu template layout:
 * row 1 = "THE MENU" title, row 2 blank, row 3 = bilingual headers, data from row 4.
 */
import * as XLSX from "xlsx";

export const JAHEZ_HEADERS = [
  "الرقم",
  "Name Item Englesh",
  "اسم الصنف باللغة العربية",
  "Category - القسم",
  "مسببات الحساية",
  "Size",
  "حجم",
  "Add",
  "اضافات",
  "Option Calories",
  "Option Price",
  "Description - الوصف",
  "Choice خيارات",
  "Image Link - رابط الصورة",
  "Item Price",
  "Item Calories",
] as const;

export interface JahezMenuItemInput {
  name: string;
  nameArabic?: string | null;
  category?: string | null;
  price: number;
  /** Optional size variants, e.g. Quarter / Half / Full */
  sizes?: { label: string; labelArabic?: string | null; price: number }[];
  description?: string | null;
  allergens?: string | null;
  imageUrl?: string | null;
  calories?: number | null;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function buildJahezRows(items: JahezMenuItemInput[]): (string | number)[][] {
  const rows: (string | number)[][] = [];

  items.forEach((item, index) => {
    const sizes = (item.sizes || []).filter((s) => Number(s.price) > 0);
    const basePrice = round2(item.price);

    const baseRow = (size?: { label: string; labelArabic?: string | null; price: number }) => [
      size ? "" : index + 1,
      size ? "" : item.name || "",
      size ? "" : item.nameArabic || "",
      size ? "" : item.category || "",
      size ? "" : item.allergens || "",
      size ? size.label : "",
      size ? size.labelArabic || "" : "",
      "",
      "",
      "",
      size ? round2(size.price) : "",
      size ? "" : item.description || "",
      "",
      size ? "" : item.imageUrl || "",
      size ? "" : basePrice,
      size ? "" : (item.calories ?? ""),
    ];

    rows.push(baseRow());
    sizes.forEach((s) => rows.push(baseRow(s)));
  });

  return rows;
}

export function buildJahezWorkbook(items: JahezMenuItemInput[]): XLSX.WorkBook {
  const aoa: (string | number)[][] = [
    ["THE MENU"],
    [],
    [...JAHEZ_HEADERS],
    ...buildJahezRows(items),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 28 },
    { wch: 20 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 36 },
    { wch: 14 },
    { wch: 34 },
    { wch: 12 },
    { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "المنيو المعتمد");
  return wb;
}

export function downloadJahezMenu(items: JahezMenuItemInput[], filename: string) {
  const wb = buildJahezWorkbook(items);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
