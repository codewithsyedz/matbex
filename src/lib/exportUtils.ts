import { format } from "date-fns";
import { branchDisplayLabel, branchInitials } from "@/components/branch/BranchBadge";
import { formatMoneyAmount, normalizeSaleTotals, roundMoney, sumMoney } from "@/lib/vatInclusive";

interface ExportData {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
}

export function exportToCSV({ headers, rows, filename }: ExportData) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((cell) => {
          // Escape quotes and wrap in quotes if contains comma
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
  link.setAttribute("download", `${filename}_${format(new Date(), "yyyy-MM-dd")}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToPDF({ headers, rows, filename }: ExportData) {
  // Create a printable HTML table
  const tableHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${filename}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #333; font-size: 18px; margin-bottom: 5px; }
        p { color: #666; font-size: 12px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background-color: #f5f5f5; border: 1px solid #ddd; padding: 10px; text-align: left; font-weight: 600; }
        td { border: 1px solid #ddd; padding: 8px; }
        tr:nth-child(even) { background-color: #fafafa; }
        @media print {
          body { padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>${filename}</h1>
      <p>Generated on ${format(new Date(), "PPP 'at' p")}</p>
      <table>
        <thead>
          <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
      <script>window.print(); window.close();</script>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(tableHTML);
    printWindow.document.close();
  }
}

export function prepareSalesExportData(
  salesData: any[],
  totalSales: number,
  dateRange: string,
  branchNameById?: (branchId: string | null | undefined) => string | null | undefined,
) {
  const headers = [
    "Date",
    "Receipt #",
    "Branch",
    "Branch Code",
    "Branch ID",
    "Payment Method",
    "Net (excl. VAT)",
    "VAT",
    "Total (incl. VAT)",
  ];
  // Every money column is derived from the same normalizer used by receipts
  // and sale notifications, so Net + VAT always equals the VAT-inclusive
  // Total the guest actually paid — including on legacy double-taxed rows.
  const grossTotals: number[] = [];
  const rows = salesData.map((sale) => {
    const name = sale.branch?.name ?? branchNameById?.(sale.branch_id) ?? null;
    const { gross, net, vat } = normalizeSaleTotals(sale);
    grossTotals.push(gross);
    return [
      format(new Date(sale.created_at), "MMM d, yyyy HH:mm"),
      sale.receipt_number || "-",
      branchDisplayLabel(name),
      sale.branch?.code || branchInitials(name) || "-",
      sale.branch_id || "-",
      sale.payment_method,
      formatMoneyAmount(net),
      formatMoneyAmount(vat),
      formatMoneyAmount(gross),
    ];
  });

  // Summary row: sum of the normalized gross amounts. Falls back to the
  // caller-supplied total only when no rows were exported.
  const summaryTotal = rows.length ? sumMoney(grossTotals) : roundMoney(totalSales);
  rows.push(["", "", "", "", "", "", "", "Total (incl. VAT):", formatMoneyAmount(summaryTotal)]);

  return {
    headers,
    rows,
    filename: `Sales_Report_${dateRange}`,
  };
}

export function prepareExpensesExportData(
  expensesData: any[],
  totalExpenses: number,
  dateRange: string,
  options?: {
    branchNameById?: Record<string, string>;
    branchLabel?: string;
    branchId?: string | null;
  }
) {
  const branchNameById = options?.branchNameById ?? {};
  const branchNameOf = (id: string | null | undefined) =>
    id ? branchNameById[id] ?? "Unknown branch" : "Unassigned";

  const headers = ["Date", "Branch", "Branch ID", "Category", "Description", "Status", "Amount"];
  const rows: string[][] = expensesData.map((expense) => [
    format(new Date(expense.expense_date), "MMM d, yyyy"),
    branchNameOf(expense.branch_id),
    expense.branch_id || "",
    expense.expense_categories?.name || "Uncategorized",
    expense.description || "-",
    expense.status || "-",
    formatMoneyAmount(expense.amount),
  ]);

  // Per-branch subtotals
  const totalsByBranch = new Map<string, { name: string; total: number; count: number }>();
  for (const expense of expensesData) {
    const key = expense.branch_id || "";
    const entry = totalsByBranch.get(key) ?? { name: branchNameOf(expense.branch_id), total: 0, count: 0 };
    entry.total += Number(expense.amount) || 0;
    entry.count += 1;
    totalsByBranch.set(key, entry);
  }

  rows.push(["", "", "", "", "", "", ""]);
  rows.push(["Totals by branch", "", "", "", "", "Count", "Amount"]);
  for (const [branchId, entry] of Array.from(totalsByBranch.entries()).sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  )) {
    rows.push(["", entry.name, branchId, "", "", String(entry.count), formatMoneyAmount(entry.total)]);
  }

  rows.push(["", "", "", "", "", "Total:", formatMoneyAmount(totalExpenses)]);

  const branchSuffix = options?.branchLabel
    ? `_${options.branchLabel.replace(/[^a-zA-Z0-9]+/g, "-")}`
    : "";

  return {
    headers,
    rows,
    filename: `Expenses_Report${branchSuffix}_${dateRange}`,
  };
}

export function prepareShiftsExportData(
  shiftsData: any[],
  dateRange: string
) {
  const headers = ["Opened At", "Closed At", "Status", "Opening Float", "Expected Cash", "Counted Cash", "Variance"];
  const rows = shiftsData.map((shift) => [
    format(new Date(shift.opened_at), "MMM d, yyyy HH:mm"),
    shift.closed_at ? format(new Date(shift.closed_at), "MMM d, yyyy HH:mm") : "-",
    shift.status,
    shift.opening_float?.toFixed(2) || "0.00",
    shift.expected_cash?.toFixed(2) || "-",
    shift.counted_cash?.toFixed(2) || "-",
    shift.variance?.toFixed(2) || "-",
  ]);

  return {
    headers,
    rows,
    filename: `Shifts_Report_${dateRange}`,
  };
}
