import { format } from "date-fns";
import { DailyProfitState } from "@/hooks/useDailyProfit";

export interface ProfitExportData {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
}

export function prepareProfitExportData(
  dailyData: DailyProfitState[],
  dateRange: string
): ProfitExportData {
  const headers = [
    "Date",
    "Gross Sales",
    "Net Sales", 
    "Food Cost",
    "Beverage Cost",
    "Labor Cost",
    "Other Expenses",
    "Overhead",
    "Prime Cost",
    "Prime Cost %",
    "Operating Profit",
    "Margin %",
    "Status",
  ];

  const sortedData = [...dailyData].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const rows = sortedData.map((day) => [
    format(new Date(day.date), "MMM d, yyyy"),
    day.grossSales.toFixed(2),
    day.netSales.toFixed(2),
    day.foodCost.toFixed(2),
    day.beverageCost.toFixed(2),
    day.laborCost.toFixed(2),
    day.otherExpenses.toFixed(2),
    day.allocatedOverhead.toFixed(2),
    day.primeCost.toFixed(2),
    day.primeCostPercentage.toFixed(1) + "%",
    day.operatingProfit.toFixed(2),
    day.operatingMarginPercentage.toFixed(1) + "%",
    day.status,
  ]);

  // Add summary row
  const totals = sortedData.reduce(
    (acc, day) => ({
      grossSales: acc.grossSales + day.grossSales,
      netSales: acc.netSales + day.netSales,
      foodCost: acc.foodCost + day.foodCost,
      beverageCost: acc.beverageCost + day.beverageCost,
      laborCost: acc.laborCost + day.laborCost,
      otherExpenses: acc.otherExpenses + day.otherExpenses,
      overhead: acc.overhead + day.allocatedOverhead,
      primeCost: acc.primeCost + day.primeCost,
      operatingProfit: acc.operatingProfit + day.operatingProfit,
    }),
    {
      grossSales: 0,
      netSales: 0,
      foodCost: 0,
      beverageCost: 0,
      laborCost: 0,
      otherExpenses: 0,
      overhead: 0,
      primeCost: 0,
      operatingProfit: 0,
    }
  );

  const avgPrimeCostPct = totals.netSales > 0 
    ? (totals.primeCost / totals.netSales) * 100 
    : 0;
  const avgMarginPct = totals.netSales > 0 
    ? (totals.operatingProfit / totals.netSales) * 100 
    : 0;

  rows.push([
    "TOTAL",
    totals.grossSales.toFixed(2),
    totals.netSales.toFixed(2),
    totals.foodCost.toFixed(2),
    totals.beverageCost.toFixed(2),
    totals.laborCost.toFixed(2),
    totals.otherExpenses.toFixed(2),
    totals.overhead.toFixed(2),
    totals.primeCost.toFixed(2),
    avgPrimeCostPct.toFixed(1) + "%",
    totals.operatingProfit.toFixed(2),
    avgMarginPct.toFixed(1) + "%",
    "",
  ]);

  return {
    headers,
    rows,
    filename: `Daily_Profit_Report_${dateRange}`,
  };
}

export function prepareWeeklySummaryExportData(
  weeklyData: Array<{
    label: string;
    profit: number;
    sales: number;
    costs: number;
    margin: number;
  }>
): ProfitExportData {
  const headers = ["Week", "Sales", "Costs", "Profit", "Margin %"];
  
  const rows = weeklyData.map((week) => [
    week.label,
    week.sales.toFixed(2),
    week.costs.toFixed(2),
    week.profit.toFixed(2),
    week.margin.toFixed(1) + "%",
  ]);

  const totals = weeklyData.reduce(
    (acc, week) => ({
      sales: acc.sales + week.sales,
      costs: acc.costs + week.costs,
      profit: acc.profit + week.profit,
    }),
    { sales: 0, costs: 0, profit: 0 }
  );

  const avgMargin = totals.sales > 0 ? (totals.profit / totals.sales) * 100 : 0;

  rows.push([
    "TOTAL",
    totals.sales.toFixed(2),
    totals.costs.toFixed(2),
    totals.profit.toFixed(2),
    avgMargin.toFixed(1) + "%",
  ]);

  return {
    headers,
    rows,
    filename: `Weekly_Profit_Summary_${format(new Date(), "yyyy-MM-dd")}`,
  };
}

export function exportProfitToPDF(data: ProfitExportData) {
  const tableHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${data.filename}</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; padding: 40px; color: #1a1a1a; }
        .header { margin-bottom: 30px; }
        h1 { color: #1a1a1a; font-size: 24px; font-weight: 600; margin-bottom: 8px; }
        .subtitle { color: #666; font-size: 14px; margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { 
          background-color: #f8f9fa; 
          border-bottom: 2px solid #e5e7eb; 
          padding: 12px 8px; 
          text-align: left; 
          font-weight: 600;
          color: #374151;
        }
        td { 
          border-bottom: 1px solid #e5e7eb; 
          padding: 10px 8px; 
          color: #4b5563;
        }
        tr:last-child td {
          font-weight: 600;
          background-color: #f8f9fa;
          color: #1a1a1a;
        }
        .footer { 
          margin-top: 40px; 
          padding-top: 20px; 
          border-top: 1px solid #e5e7eb; 
          font-size: 11px; 
          color: #9ca3af; 
        }
        @media print {
          body { padding: 20px; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${data.filename.replace(/_/g, ' ')}</h1>
        <p class="subtitle">Generated on ${format(new Date(), "PPPP 'at' p")}</p>
      </div>
      <table>
        <thead>
          <tr>${data.headers.map((h) => `<th>${h}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${data.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
      <div class="footer">
        <p>This report was automatically generated. Data may be estimated for some periods.</p>
      </div>
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
