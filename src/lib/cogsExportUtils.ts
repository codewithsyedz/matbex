import { format } from "date-fns";
import { COGSSubmission, STOCK_CATEGORIES, SHIFT_TYPES } from "@/hooks/useCOGSSubmissions";

// Generate Excel-compatible CSV with COGS data
export function exportCOGSToExcel(
  submission: COGSSubmission,
  stockItems: Array<{ stock_type: string; category: string; category_label: string; amount: number }>,
  purchases: Array<{ supplier_name: string | null; invoice_number: string | null; item_type: string; amount: number; payment_mode: string }>,
  currency: string = "SAR"
) {
  const lines: string[] = [];
  
  // Header
  lines.push("DAILY COGS REPORT");
  lines.push(`Date,${format(new Date(submission.submission_date), "MMMM d, yyyy")}`);
  lines.push(`Shift,${SHIFT_TYPES.find(s => s.value === submission.shift_type)?.label || submission.shift_type}`);
  lines.push(`Cashier,${submission.cashier_name}`);
  lines.push(`Status,${submission.status.toUpperCase()}`);
  lines.push("");
  
  // Opening Stock Section
  lines.push("OPENING STOCK");
  lines.push("Category,Amount");
  const openingItems = stockItems.filter(i => i.stock_type === 'opening');
  STOCK_CATEGORIES.forEach(cat => {
    const item = openingItems.find(i => i.category === cat.value);
    lines.push(`${cat.label},${item?.amount || 0}`);
  });
  const openingTotal = openingItems.reduce((sum, i) => sum + Number(i.amount), 0);
  lines.push(`Total Opening Stock,${openingTotal}`);
  lines.push("");
  
  // Purchases Section
  lines.push("PURCHASES DURING SHIFT");
  lines.push("Supplier,Invoice #,Item Type,Payment Mode,Amount");
  purchases.forEach(p => {
    const itemType = STOCK_CATEGORIES.find(c => c.value === p.item_type)?.label || p.item_type;
    lines.push(`${p.supplier_name || "-"},${p.invoice_number || "MISSING"},${itemType},${p.payment_mode},${p.amount}`);
  });
  const purchasesTotal = purchases.reduce((sum, p) => sum + Number(p.amount), 0);
  lines.push(`Total Purchases,,,,${purchasesTotal}`);
  lines.push("");
  
  // Closing Stock Section
  lines.push("CLOSING STOCK");
  lines.push("Category,Amount");
  const closingItems = stockItems.filter(i => i.stock_type === 'closing');
  STOCK_CATEGORIES.forEach(cat => {
    const item = closingItems.find(i => i.category === cat.value);
    lines.push(`${cat.label},${item?.amount || 0}`);
  });
  const closingTotal = closingItems.reduce((sum, i) => sum + Number(i.amount), 0);
  lines.push(`Total Closing Stock,${closingTotal}`);
  lines.push("");
  
  // Sales Summary
  lines.push("SALES SUMMARY");
  lines.push(`Cash Sales,${submission.cash_sales}`);
  lines.push(`Card Sales,${submission.card_sales}`);
  lines.push(`Online/Delivery Sales,${submission.online_sales}`);
  lines.push(`Total Sales,${submission.total_sales}`);
  lines.push("");
  
  // COGS Calculation
  lines.push("COGS CALCULATION");
  lines.push(`Opening Stock (A),${openingTotal}`);
  lines.push(`+ Purchases (B),${purchasesTotal}`);
  lines.push(`- Closing Stock (C),${closingTotal}`);
  lines.push(`= COGS (A+B-C),${submission.cogs}`);
  lines.push("");
  
  // KPIs
  lines.push("KEY METRICS");
  lines.push(`Food Cost %,${submission.food_cost_percentage.toFixed(2)}%`);
  lines.push(`Target Range,≤40% Healthy | 41-45% Warning | >45% Critical`);
  lines.push(`Status,${submission.food_cost_percentage <= 40 ? "HEALTHY" : submission.food_cost_percentage <= 45 ? "WARNING" : "CRITICAL"}`);
  if (submission.variance_percentage) {
    lines.push(`Variance %,${submission.variance_percentage.toFixed(2)}%`);
  }
  lines.push("");
  
  // Signatures
  lines.push("SIGN-OFF");
  lines.push(`Cashier Signed,${submission.cashier_signature_at ? format(new Date(submission.cashier_signature_at), "MMM d, h:mm a") : "Pending"}`);
  lines.push(`Kitchen Verified,${submission.kitchen_verified_at ? `${submission.kitchen_incharge_name} - ${format(new Date(submission.kitchen_verified_at), "MMM d, h:mm a")}` : "Pending"}`);
  lines.push(`Manager Approved,${submission.approved_at ? format(new Date(submission.approved_at), "MMM d, h:mm a") : "Pending"}`);
  
  // Create and download CSV
  const csvContent = lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `COGS_${format(new Date(submission.submission_date), "yyyy-MM-dd")}_${submission.shift_type}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Generate daily summary report for multiple submissions
export function exportCOGSSummaryReport(
  submissions: COGSSubmission[],
  dateRange: { from: Date; to: Date },
  currency: string = "SAR"
) {
  const lines: string[] = [];
  
  // Header
  lines.push("COGS SUMMARY REPORT");
  lines.push(`Period,${format(dateRange.from, "MMM d, yyyy")} - ${format(dateRange.to, "MMM d, yyyy")}`);
  lines.push(`Generated,${format(new Date(), "MMM d, yyyy h:mm a")}`);
  lines.push("");
  
  // Summary Stats
  const totalCOGS = submissions.reduce((sum, s) => sum + Number(s.cogs), 0);
  const totalSales = submissions.reduce((sum, s) => sum + Number(s.total_sales), 0);
  const avgFoodCost = submissions.length > 0 
    ? submissions.reduce((sum, s) => sum + Number(s.food_cost_percentage), 0) / submissions.length 
    : 0;
  
  lines.push("SUMMARY STATISTICS");
  lines.push(`Total Submissions,${submissions.length}`);
  lines.push(`Total COGS,${totalCOGS.toFixed(2)}`);
  lines.push(`Total Sales,${totalSales.toFixed(2)}`);
  lines.push(`Average Food Cost %,${avgFoodCost.toFixed(2)}%`);
  lines.push(`Approved,${submissions.filter(s => s.status === 'approved').length}`);
  lines.push(`Pending,${submissions.filter(s => s.status === 'submitted').length}`);
  lines.push(`Rejected,${submissions.filter(s => s.status === 'rejected').length}`);
  lines.push("");
  
  // Daily breakdown
  lines.push("DAILY BREAKDOWN");
  lines.push("Date,Shift,Opening Stock,Purchases,Closing Stock,COGS,Total Sales,Food Cost %,Status");
  submissions.forEach(s => {
    const shiftLabel = SHIFT_TYPES.find(t => t.value === s.shift_type)?.label || s.shift_type;
    lines.push([
      format(new Date(s.submission_date), "yyyy-MM-dd"),
      shiftLabel,
      s.opening_stock_value.toFixed(2),
      s.purchases_value.toFixed(2),
      s.closing_stock_value.toFixed(2),
      s.cogs.toFixed(2),
      s.total_sales.toFixed(2),
      `${s.food_cost_percentage.toFixed(2)}%`,
      s.status.toUpperCase()
    ].join(","));
  });
  
  // Create and download
  const csvContent = lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `COGS_Summary_${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
