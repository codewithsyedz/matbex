import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { exportToCSV } from "@/lib/exportUtils";
import { exportProfitLossPdf } from "@/lib/profitLossPdf";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";

interface ProfitLossStatementProps {
  dateRange: string;
  totalSales: number;
  discounts: number;
  refunds: number;
  foodCost: number;
  beverageCost: number;
  laborCost: number;
  overheadItems: { name: string; amount: number }[];
  otherExpenses: number;
  /** Optional branch scope shown on the exported PDF. */
  branchLabel?: string | null;
}

export function ProfitLossStatement({
  dateRange,
  totalSales,
  discounts,
  refunds,
  foodCost,
  beverageCost,
  laborCost,
  overheadItems,
  otherExpenses,
  branchLabel,
}: ProfitLossStatementProps) {
  const { format: formatCurrency, displayCurrency } = useCurrency();
  const { tenant } = useAuth();

  // Calculations
  const netSales = totalSales - discounts - refunds;
  const totalFoodBevCost = foodCost + beverageCost;
  const grossProfit = netSales - totalFoodBevCost;
  const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  const totalLabor = laborCost;
  const primeCost = totalFoodBevCost + totalLabor;
  const primeCostPercent = netSales > 0 ? (primeCost / netSales) * 100 : 0;

  const totalOverhead = overheadItems.reduce((sum, item) => sum + item.amount, 0);
  const totalOperatingExpenses = totalLabor + totalOverhead + otherExpenses;
  
  const operatingProfit = grossProfit - totalOperatingExpenses + totalFoodBevCost; // Adjusted calculation
  const operatingProfitActual = netSales - primeCost - totalOverhead - otherExpenses;
  const operatingMargin = netSales > 0 ? (operatingProfitActual / netSales) * 100 : 0;

  const netIncome = operatingProfitActual;
  const netMargin = netSales > 0 ? (netIncome / netSales) * 100 : 0;

  const LineItem = ({ 
    label, 
    amount, 
    isTotal = false, 
    isSubtotal = false,
    isNegative = false,
    showPercent = false,
    indent = false
  }: { 
    label: string; 
    amount: number; 
    isTotal?: boolean;
    isSubtotal?: boolean;
    isNegative?: boolean;
    showPercent?: boolean;
    indent?: boolean;
  }) => {
    const percent = netSales > 0 ? (amount / netSales) * 100 : 0;
    return (
      <div className={`flex justify-between py-1.5 ${isTotal ? "font-semibold text-base border-t-2 border-b-2 border-foreground mt-2 pt-2" : ""} ${isSubtotal ? "font-medium border-t border-border pt-2" : ""}`}>
        <span className={`${indent ? "pl-4" : ""} ${isTotal || isSubtotal ? "" : "text-muted-foreground"}`}>
          {label}
        </span>
        <div className="flex items-center gap-3">
          {showPercent && (
            <span className="text-xs text-muted-foreground w-12 text-right">
              {percent.toFixed(1)}%
            </span>
          )}
          <span className={`tabular-nums w-28 text-right ${isNegative && amount > 0 ? "text-destructive" : ""}`}>
            {isNegative && amount > 0 ? "(" : ""}{formatCurrency(Math.abs(amount))}{isNegative && amount > 0 ? ")" : ""}
          </span>
        </div>
      </div>
    );
  };

  const handleExportPDF = async () => {
    try {
      await exportProfitLossPdf({
        restaurantName: tenant?.name ?? "Restaurant",
        branchLabel,
        periodLabel: dateRange,
        currency: displayCurrency,
        netSales,
        lines: [
          { label: "REVENUE", amount: 0, section: true },
          { label: "Gross Sales", amount: totalSales, indent: true },
          { label: "Less: Discounts", amount: -discounts, indent: true },
          { label: "Less: Refunds", amount: -refunds, indent: true },
          { label: "Net Sales", amount: netSales, emphasis: true, percent: 100 },
          { label: "COST OF GOODS SOLD", amount: 0, section: true },
          { label: "Food Cost", amount: foodCost, indent: true },
          { label: "Beverage Cost", amount: beverageCost, indent: true },
          { label: "Total COGS", amount: totalFoodBevCost, emphasis: true },
          { label: "GROSS PROFIT", amount: grossProfit, emphasis: true, percent: grossMargin },
          { label: "OPERATING EXPENSES", amount: 0, section: true },
          { label: "Labor Cost", amount: laborCost, indent: true },
          ...overheadItems.map((item) => ({
            label: item.name,
            amount: item.amount,
            indent: true,
          })),
          { label: "Other Expenses", amount: otherExpenses, indent: true },
          {
            label: "Total Operating Expenses",
            amount: laborCost + totalOverhead + otherExpenses,
            emphasis: true,
          },
          { label: "PRIME COST", amount: primeCost, emphasis: true, percent: primeCostPercent },
          {
            label: "OPERATING PROFIT",
            amount: operatingProfitActual,
            emphasis: true,
            percent: operatingMargin,
          },
          { label: "NET INCOME", amount: netIncome, emphasis: true, percent: netMargin },
        ],
        fileName: `PL_Statement_${format(new Date(), "yyyy-MM-dd")}.pdf`,
      });
      toast.success("P&L Statement exported as PDF");
    } catch (err) {
      console.error(err);
      toast.error("Could not generate the P&L PDF");
    }
  };

  const handleExportCSV = () => {
    const data = {
      headers: ["Description", "Percentage", "Amount"],
      rows: [
        ["Gross Sales", "", totalSales],
        ["Discounts", "", -discounts],
        ["Refunds", "", -refunds],
        ["Net Sales", "100%", netSales],
        ["Food Cost", `${((foodCost / netSales) * 100).toFixed(1)}%`, foodCost],
        ["Beverage Cost", `${((beverageCost / netSales) * 100).toFixed(1)}%`, beverageCost],
        ["Gross Profit", `${grossMargin.toFixed(1)}%`, grossProfit],
        ["Labor Cost", `${((laborCost / netSales) * 100).toFixed(1)}%`, laborCost],
        ["Total Overhead", `${((totalOverhead / netSales) * 100).toFixed(1)}%`, totalOverhead],
        ["Other Expenses", `${((otherExpenses / netSales) * 100).toFixed(1)}%`, otherExpenses],
        ["Operating Profit", `${operatingMargin.toFixed(1)}%`, operatingProfitActual],
        ["Net Income", `${netMargin.toFixed(1)}%`, netIncome],
      ],
      filename: `PL_Statement_${format(new Date(), "yyyy-MM-dd")}`,
    };
    exportToCSV(data);
    toast.success("P&L Statement exported as CSV");
  };

  return (
    <Card className="fade-slide-in">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Profit & Loss Statement</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{dateRange}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <FileText className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Revenue Section */}
        <div>
          <h4 className="text-sm font-semibold text-primary mb-2">REVENUE</h4>
          <LineItem label="Gross Sales" amount={totalSales} />
          <LineItem label="Less: Discounts" amount={discounts} isNegative indent />
          <LineItem label="Less: Refunds" amount={refunds} isNegative indent />
          <LineItem label="Net Sales" amount={netSales} isSubtotal showPercent />
        </div>

        <Separator />

        {/* Cost of Goods Sold */}
        <div>
          <h4 className="text-sm font-semibold text-primary mb-2">COST OF GOODS SOLD</h4>
          <LineItem label="Food Cost" amount={foodCost} showPercent indent />
          <LineItem label="Beverage Cost" amount={beverageCost} showPercent indent />
          <LineItem label="Total COGS" amount={totalFoodBevCost} isSubtotal showPercent />
        </div>

        <div className="bg-success/10 rounded-lg p-3">
          <LineItem label="GROSS PROFIT" amount={grossProfit} isSubtotal />
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={grossMargin >= 60 ? "default" : "secondary"}>
              {grossMargin.toFixed(1)}% Gross Margin
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Operating Expenses */}
        <div>
          <h4 className="text-sm font-semibold text-primary mb-2">OPERATING EXPENSES</h4>
          <LineItem label="Labor Cost" amount={laborCost} showPercent indent />
          
          {overheadItems.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1 pl-4">Overhead:</p>
              {overheadItems.map((item, index) => (
                <LineItem key={index} label={item.name} amount={item.amount} showPercent indent />
              ))}
            </div>
          )}
          
          <LineItem label="Other Expenses" amount={otherExpenses} showPercent indent />
          <LineItem label="Total Operating Expenses" amount={totalLabor + totalOverhead + otherExpenses} isSubtotal showPercent />
        </div>

        {/* Prime Cost Indicator */}
        <div className={`rounded-lg p-3 ${primeCostPercent <= 65 ? "bg-success/10" : "bg-warning/10"}`}>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Prime Cost (Food + Labor)</span>
            <div className="flex items-center gap-2">
              <Badge variant={primeCostPercent <= 65 ? "default" : "destructive"}>
                {primeCostPercent.toFixed(1)}%
              </Badge>
              <span className="font-semibold">{formatCurrency(primeCost)}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Operating Profit */}
        <div className={`rounded-lg p-4 ${operatingProfitActual >= 0 ? "bg-success/10" : "bg-destructive/10"}`}>
          <LineItem label="OPERATING PROFIT" amount={operatingProfitActual} isTotal />
          <div className="flex items-center gap-2 mt-2">
            <Badge variant={operatingMargin >= 10 ? "default" : operatingMargin >= 5 ? "secondary" : "destructive"}>
              {operatingMargin.toFixed(1)}% Operating Margin
            </Badge>
            <span className="text-xs text-muted-foreground">
              Target: ≥10%
            </span>
          </div>
        </div>

        {/* Net Income */}
        <div className={`rounded-lg p-4 border-2 ${netIncome >= 0 ? "border-success bg-success/5" : "border-destructive bg-destructive/5"}`}>
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold">NET INCOME</span>
            <span className={`text-2xl font-bold ${netIncome >= 0 ? "text-success" : "text-destructive"}`}>
              {formatCurrency(netIncome)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Net Margin: {netMargin.toFixed(1)}%
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
