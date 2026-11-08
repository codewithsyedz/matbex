import { format } from "date-fns";

/** Saudi Arabia standard VAT rate. */
export const STANDARD_VAT_RATE = 0.15;

export type BoxKey =
  | "box1" | "box1_1" | "box2" | "box3" | "box4" | "box5"
  | "box7" | "box7_1" | "box8" | "box8_1" | "box9" | "box9_1"
  | "box10" | "box11";

export interface BoxRow {
  key: BoxKey;
  number: string;
  description: string;
  /** Arabic description as used by the ZATCA portal */
  descriptionAr?: string;
  /** Plain-English plain-language hint for non-accountants */
  hint?: string;
  /** Net taxable amount */
  amount: number;
  adjustment: number;
  /** VAT rate used to compute VAT amount; null = no VAT line shown */
  vatRate: number | null;
}

export interface VatReturnComputation {
  sales: BoxRow[];
  purchases: BoxRow[];
  totals: {
    salesAmount: number;
    salesAdjustment: number;
    salesVat: number;
    purchasesAmount: number;
    purchasesAdjustment: number;
    purchasesVat: number;
    /** Box 13 = sales VAT - purchases VAT (after adjustments) */
    netVatBeforeCorrections: number;
    /** Box 16 = Box 13 + Box 14 - Box 15 */
    netVatDue: number;
  };
  corrections: number;
  creditCarried: number;
}

export interface VatAdjustments {
  box1_adjustment: number;
  box1_1_amount: number;
  box1_1_adjustment: number;
  box2_amount: number;
  box2_adjustment: number;
  box3_amount: number;
  box3_adjustment: number;
  box4_amount: number;
  box4_adjustment: number;
  box5_amount: number;
  box5_adjustment: number;
  box7_adjustment: number;
  box7_1_amount: number;
  box7_1_adjustment: number;
  box8_amount: number;
  box8_adjustment: number;
  box8_1_amount: number;
  box8_1_adjustment: number;
  box9_amount: number;
  box9_adjustment: number;
  box9_1_amount: number;
  box9_1_adjustment: number;
  box10_amount: number;
  box10_adjustment: number;
  box11_amount: number;
  box11_adjustment: number;
  box14_corrections: number;
  box15_credit_carried: number;
}

export const EMPTY_ADJUSTMENTS: VatAdjustments = {
  box1_adjustment: 0,
  box1_1_amount: 0, box1_1_adjustment: 0,
  box2_amount: 0, box2_adjustment: 0,
  box3_amount: 0, box3_adjustment: 0,
  box4_amount: 0, box4_adjustment: 0,
  box5_amount: 0, box5_adjustment: 0,
  box7_adjustment: 0,
  box7_1_amount: 0, box7_1_adjustment: 0,
  box8_amount: 0, box8_adjustment: 0,
  box8_1_amount: 0, box8_1_adjustment: 0,
  box9_amount: 0, box9_adjustment: 0,
  box9_1_amount: 0, box9_1_adjustment: 0,
  box10_amount: 0, box10_adjustment: 0,
  box11_amount: 0, box11_adjustment: 0,
  box14_corrections: 0,
  box15_credit_carried: 0,
};

/** Period helpers */
export type PeriodMode = "quarter" | "month";

export function quarterBounds(year: number, q: 1 | 2 | 3 | 4) {
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0); // last day of last month
  return { start, end };
}

export function monthBounds(year: number, monthIdx: number) {
  const start = new Date(year, monthIdx, 1);
  const end = new Date(year, monthIdx + 1, 0);
  return { start, end };
}

export function formatPeriodLabel(start: Date, end: Date) {
  return `${format(start, "dd MMM yyyy")} – ${format(end, "dd MMM yyyy")}`;
}

/**
 * Sales transactions row used for VAT computation.
 * The POS stores totals tax-inclusive; we use `subtotal` as taxable base
 * and `tax` as VAT collected.
 */
export interface SalesRow {
  subtotal: number | string | null;
  tax: number | string | null;
  total: number | string | null;
}

/** Purchase invoice row */
export interface PurchaseRow {
  subtotal: number | string | null;
  tax_amount: number | string | null;
  total_amount: number | string | null;
}

/** Expense row used as a VAT-inclusive purchase fallback */
export interface ExpenseRow {
  amount: number | string | null;
}

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? Number(n) : 0;
};

/**
 * Compute the VAT return from raw sales + purchases, applying user adjustments.
 * Box 1 (standard sales 15%): sum of POS subtotal + VAT = sum of POS tax.
 * Box 7 (standard purchases 15%): sum of purchase invoice subtotal + tax_amount.
 * Expenses without their own VAT: treated as VAT-inclusive at 15%.
 */
export function computeVatReturn(
  sales: SalesRow[],
  purchases: PurchaseRow[],
  expenses: ExpenseRow[],
  adjustments: VatAdjustments,
): VatReturnComputation {
  // ---- Sales: Box 1 (15%) only auto-derived ----
  let box1Net = 0;
  let box1Vat = 0;
  for (const r of sales) {
    const sub = num(r.subtotal);
    const tax = num(r.tax);
    if (tax > 0) {
      box1Net += sub;
      box1Vat += tax;
    } else {
      // POS sale with no recorded tax: treat total as VAT-inclusive at 15%
      const total = num(r.total);
      const net = total / (1 + STANDARD_VAT_RATE);
      box1Net += net;
      box1Vat += total - net;
    }
  }

  // ---- Purchases ----
  let box7Net = 0;
  for (const p of purchases) {
    box7Net += num(p.subtotal);
  }
  // Expenses (VAT-inclusive at 15%, simple fallback)
  for (const e of expenses) {
    const amt = num(e.amount);
    if (amt > 0) box7Net += amt / (1 + STANDARD_VAT_RATE);
  }

  const sales_: BoxRow[] = [
    { key: "box1", number: "1", description: "Standard rated domestic sales (15%)", descriptionAr: "المبيعات المحلية الخاضعة للنسبة الأساسية (15%)", hint: "Auto-pulled from your POS sales.", amount: round(box1Net), adjustment: adjustments.box1_adjustment, vatRate: 0.15 },
    { key: "box1_1", number: "1.1", description: "Standard rated domestic sales (5%)", descriptionAr: "المبيعات المحلية الخاضعة للنسبة الأساسية (5%)", amount: adjustments.box1_1_amount, adjustment: adjustments.box1_1_adjustment, vatRate: 0.05 },
    { key: "box2", number: "2", description: "Private Healthcare/Private Education/First house sales to citizens", descriptionAr: "الرعاية الصحية الخاصة / التعليم الخاص / المنازل الأولى للمواطنين", amount: adjustments.box2_amount, adjustment: adjustments.box2_adjustment, vatRate: null },
    { key: "box3", number: "3", description: "Zero rated domestic sales", descriptionAr: "المبيعات المحلية الخاضعة لنسبة الصفر", amount: adjustments.box3_amount, adjustment: adjustments.box3_adjustment, vatRate: null },
    { key: "box4", number: "4", description: "Exports", descriptionAr: "الصادرات", amount: adjustments.box4_amount, adjustment: adjustments.box4_adjustment, vatRate: null },
    { key: "box5", number: "5", description: "Exempt sales", descriptionAr: "المبيعات المعفاة", amount: adjustments.box5_amount, adjustment: adjustments.box5_adjustment, vatRate: null },
  ];

  const purchases_: BoxRow[] = [
    { key: "box7", number: "7", description: "Standard rated domestic purchases (15%)", descriptionAr: "المشتريات المحلية الخاضعة للنسبة الأساسية (15%)", hint: "Auto-pulled from purchase invoices and expenses.", amount: round(box7Net), adjustment: adjustments.box7_adjustment, vatRate: 0.15 },
    { key: "box7_1", number: "7.1", description: "Standard rated domestic purchases (5%)", descriptionAr: "المشتريات المحلية الخاضعة للنسبة الأساسية (5%)", amount: adjustments.box7_1_amount, adjustment: adjustments.box7_1_adjustment, vatRate: 0.05 },
    { key: "box8", number: "8", description: "Imports subject to VAT paid at customs (15%)", descriptionAr: "الواردات الخاضعة للضريبة المدفوعة في الجمارك (15%)", amount: adjustments.box8_amount, adjustment: adjustments.box8_adjustment, vatRate: 0.15 },
    { key: "box8_1", number: "8.1", description: "Imports subject to VAT paid at customs (5%)", descriptionAr: "الواردات الخاضعة للضريبة المدفوعة في الجمارك (5%)", amount: adjustments.box8_1_amount, adjustment: adjustments.box8_1_adjustment, vatRate: 0.05 },
    { key: "box9", number: "9", description: "Imports subject to VAT accounted for through reverse charge mechanism (15%)", descriptionAr: "الواردات الخاضعة لآلية الاحتساب العكسي (15%)", amount: adjustments.box9_amount, adjustment: adjustments.box9_adjustment, vatRate: 0.15 },
    { key: "box9_1", number: "9.1", description: "Imports subject to VAT accounted for through reverse charge mechanism (5%)", descriptionAr: "الواردات الخاضعة لآلية الاحتساب العكسي (5%)", amount: adjustments.box9_1_amount, adjustment: adjustments.box9_1_adjustment, vatRate: 0.05 },
    { key: "box10", number: "10", description: "Zero rated purchases", descriptionAr: "المشتريات الخاضعة لنسبة الصفر", amount: adjustments.box10_amount, adjustment: adjustments.box10_adjustment, vatRate: null },
    { key: "box11", number: "11", description: "Exempt purchases", descriptionAr: "المشتريات المعفاة", amount: adjustments.box11_amount, adjustment: adjustments.box11_adjustment, vatRate: null },
  ];

  const sumVat = (rows: BoxRow[]) =>
    rows.reduce(
      (acc, r) => acc + (r.vatRate != null ? (r.amount + r.adjustment) * r.vatRate : 0),
      0,
    );

  const salesAmount = sales_.reduce((a, r) => a + r.amount, 0);
  const salesAdj = sales_.reduce((a, r) => a + r.adjustment, 0);
  const salesVat = sumVat(sales_);
  const purchasesAmount = purchases_.reduce((a, r) => a + r.amount, 0);
  const purchasesAdj = purchases_.reduce((a, r) => a + r.adjustment, 0);
  const purchasesVat = sumVat(purchases_);

  const netVatBeforeCorrections = salesVat - purchasesVat;
  const netVatDue = netVatBeforeCorrections + adjustments.box14_corrections - adjustments.box15_credit_carried;

  return {
    sales: sales_,
    purchases: purchases_,
    totals: {
      salesAmount: round(salesAmount),
      salesAdjustment: round(salesAdj),
      salesVat: round(salesVat),
      purchasesAmount: round(purchasesAmount),
      purchasesAdjustment: round(purchasesAdj),
      purchasesVat: round(purchasesVat),
      netVatBeforeCorrections: round(netVatBeforeCorrections),
      netVatDue: round(netVatDue),
    },
    corrections: adjustments.box14_corrections,
    creditCarried: adjustments.box15_credit_carried,
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export function buildVatReturnCsv(result: VatReturnComputation): string {
  const rows: string[][] = [
    ["Section", "Box#", "Description", "Amount", "Adjustment", "VAT Amount"],
  ];
  for (const r of result.sales) {
    rows.push([
      "Sales",
      r.number,
      r.description,
      r.amount.toFixed(2),
      r.adjustment.toFixed(2),
      r.vatRate != null ? ((r.amount + r.adjustment) * r.vatRate).toFixed(2) : "",
    ]);
  }
  rows.push([
    "Sales",
    "6",
    "Total Sales",
    result.totals.salesAmount.toFixed(2),
    result.totals.salesAdjustment.toFixed(2),
    result.totals.salesVat.toFixed(2),
  ]);
  for (const r of result.purchases) {
    rows.push([
      "Purchases",
      r.number,
      r.description,
      r.amount.toFixed(2),
      r.adjustment.toFixed(2),
      r.vatRate != null ? ((r.amount + r.adjustment) * r.vatRate).toFixed(2) : "",
    ]);
  }
  rows.push([
    "Purchases",
    "12",
    "Total Purchases",
    result.totals.purchasesAmount.toFixed(2),
    result.totals.purchasesAdjustment.toFixed(2),
    result.totals.purchasesVat.toFixed(2),
  ]);
  rows.push(["Net VAT", "13", "Total VAT due for current period", "", "", result.totals.netVatBeforeCorrections.toFixed(2)]);
  rows.push(["Net VAT", "14", "Corrections from previous period", "", "", result.corrections.toFixed(2)]);
  rows.push(["Net VAT", "15", "VAT credit carried forward", "", "", result.creditCarried.toFixed(2)]);
  rows.push(["Net VAT", "16", "Net VAT due (or claim)", "", "", result.totals.netVatDue.toFixed(2)]);

  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}