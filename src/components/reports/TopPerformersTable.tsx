import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  Award,
  AlertTriangle
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";

interface DayPerformance {
  date: string;
  sales: number;
  expenses: number;
  profit: number;
  margin: number;
}

interface CategoryPerformance {
  name: string;
  total: number;
  count: number;
  avgValue: number;
}

interface TopPerformersTableProps {
  dailyPerformance: DayPerformance[];
  expensesByCategory: CategoryPerformance[];
  paymentMethodBreakdown: { method: string; total: number; count: number }[];
}

export function TopPerformersTable({
  dailyPerformance,
  expensesByCategory,
  paymentMethodBreakdown,
}: TopPerformersTableProps) {
  const { format: formatCurrency } = useCurrency();

  // Sort and get top/bottom performers
  const sortedByProfit = [...dailyPerformance].sort((a, b) => b.profit - a.profit);
  const bestDays = sortedByProfit.slice(0, 5);
  const worstDays = sortedByProfit.slice(-5).reverse();

  const sortedBySales = [...dailyPerformance].sort((a, b) => b.sales - a.sales);
  const highestSalesDays = sortedBySales.slice(0, 5);

  // Category analysis
  const sortedCategories = [...expensesByCategory].sort((a, b) => b.total - a.total);

  // Payment method analysis
  const sortedPayments = [...paymentMethodBreakdown].sort((a, b) => b.total - a.total);
  const totalPayments = sortedPayments.reduce((sum, p) => sum + p.total, 0);

  return (
    <div className="space-y-6">
      {/* Best & Worst Days Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Best Performing Days */}
        <Card className="fade-slide-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Award className="h-4 w-4 text-success" />
              Top 5 Profitable Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bestDays.map((day, index) => (
                  <TableRow key={day.date}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {index === 0 && <Badge variant="default" className="text-xs">Best</Badge>}
                        {format(new Date(day.date), "MMM d")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(day.sales)}</TableCell>
                    <TableCell className="text-right text-success font-medium">
                      {formatCurrency(day.profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={day.margin >= 15 ? "default" : "secondary"}>
                        {day.margin.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {bestDays.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Worst Performing Days */}
        <Card className="fade-slide-in" style={{ animationDelay: "50ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Bottom 5 Days (Needs Attention)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worstDays.map((day, index) => (
                  <TableRow key={day.date}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {index === 0 && <Badge variant="destructive" className="text-xs">Lowest</Badge>}
                        {format(new Date(day.date), "MMM d")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(day.sales)}</TableCell>
                    <TableCell className={`text-right font-medium ${day.profit >= 0 ? "" : "text-destructive"}`}>
                      {formatCurrency(day.profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={day.margin >= 10 ? "secondary" : "destructive"}>
                        {day.margin.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {worstDays.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Category & Payment Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expense Categories */}
        <Card className="fade-slide-in" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Expense Categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCategories.slice(0, 8).map((cat) => (
                  <TableRow key={cat.name}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(cat.total)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cat.count}</TableCell>
                    <TableCell className="text-right">{formatCurrency(cat.avgValue)}</TableCell>
                  </TableRow>
                ))}
                {sortedCategories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No expense data
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Payment Methods */}
        <Card className="fade-slide-in" style={{ animationDelay: "150ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">% Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPayments.map((payment) => (
                  <TableRow key={payment.method}>
                    <TableCell className="font-medium capitalize">{payment.method}</TableCell>
                    <TableCell className="text-right">{formatCurrency(payment.total)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{payment.count}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">
                        {totalPayments > 0 ? ((payment.total / totalPayments) * 100).toFixed(1) : 0}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedPayments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No sales data
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Highest Sales Days */}
      <Card className="fade-slide-in" style={{ animationDelay: "200ms" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Highest Revenue Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {highestSalesDays.map((day, index) => (
              <div 
                key={day.date}
                className={`p-4 rounded-lg border ${index === 0 ? "bg-primary/5 border-primary" : "bg-muted/50"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {index === 0 && <Badge>Peak</Badge>}
                  <span className="text-sm font-medium">
                    {format(new Date(day.date), "MMM d")}
                  </span>
                </div>
                <p className="text-xl font-semibold">{formatCurrency(day.sales)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Profit: {formatCurrency(day.profit)}
                </p>
              </div>
            ))}
            {highestSalesDays.length === 0 && (
              <div className="col-span-full text-center text-muted-foreground py-8">
                No sales data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
