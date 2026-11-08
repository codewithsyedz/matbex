import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar, ClipboardCheck, Loader2, TrendingDown, Package, BookCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { useWeeklyCOGS, WeeklyItem, WeeklyStocktake, StocktakeLineItem } from "@/hooks/useWeeklyCOGS";
import { cn } from "@/lib/utils";

export function WeeklyCOGSWizard() {
  const { format: formatCurrency } = useCurrency();
  const {
    stocktakes,
    stocktakesLoading,
    fetchWeeklyItems,
    fetchStocktakeItems,
    createStocktake,
    postToLedger,
    hasStocktakeForWeek,
    currentWeekStart,
    currentWeekEnd,
  } = useWeeklyCOGS();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedStocktake, setSelectedStocktake] = useState<WeeklyStocktake | null>(null);
  const [stocktakeItems, setStocktakeItems] = useState<StocktakeLineItem[]>([]);
  
  // Wizard state
  const [selectedWeek, setSelectedWeek] = useState<'current' | 'previous'>('current');
  const [weeklyItems, setWeeklyItems] = useState<WeeklyItem[]>([]);
  const [closingCounts, setClosingCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const weekStart = selectedWeek === 'current' ? currentWeekStart : subWeeks(currentWeekStart, 1);
  const weekEnd = selectedWeek === 'current' ? currentWeekEnd : subWeeks(currentWeekEnd, 1);
  const weekAlreadyDone = hasStocktakeForWeek(weekEnd);

  // Load weekly items when wizard opens or week changes
  useEffect(() => {
    if (wizardOpen) {
      loadWeeklyItems();
    }
  }, [wizardOpen, selectedWeek]);

  const loadWeeklyItems = async () => {
    setLoading(true);
    try {
      const items = await fetchWeeklyItems(weekStart, weekEnd);
      setWeeklyItems(items);
      // Pre-fill closing counts with current stock
      const counts: Record<string, string> = {};
      items.forEach(item => {
        counts[item.item_id] = item.current_stock.toString();
      });
      setClosingCounts(counts);
    } catch (error) {
      console.error('Error loading weekly items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClosingChange = (itemId: string, value: string) => {
    setClosingCounts(prev => ({ ...prev, [itemId]: value }));
  };

  const calculateConsumption = (item: WeeklyItem) => {
    const closing = parseFloat(closingCounts[item.item_id] || '0');
    return {
      qty: item.opening_qty + item.purchases_qty - closing,
      value: item.opening_value + item.purchases_value - (closing * item.unit_cost),
    };
  };

  const totalCOGS = weeklyItems.reduce((sum, item) => {
    return sum + calculateConsumption(item).value;
  }, 0);

  const handleSubmit = async () => {
    const items = weeklyItems.map(item => ({
      itemId: item.item_id,
      closingQty: parseFloat(closingCounts[item.item_id] || '0'),
    }));

    await createStocktake.mutateAsync({
      weekStart,
      weekEnd,
      items,
      notes: notes.trim() || undefined,
    });

    setWizardOpen(false);
    setNotes("");
    setClosingCounts({});
  };

  const handleViewDetails = async (stocktake: WeeklyStocktake) => {
    setSelectedStocktake(stocktake);
    try {
      const items = await fetchStocktakeItems(stocktake.id);
      setStocktakeItems(items);
      setDetailOpen(true);
    } catch (error) {
      console.error('Error loading stocktake items:', error);
    }
  };

  const handlePostToLedger = async () => {
    if (!selectedStocktake) return;
    await postToLedger.mutateAsync(selectedStocktake.id);
    setDetailOpen(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'posted':
        return <Badge className="bg-green-500/20 text-green-700 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Posted</Badge>;
      case 'submitted':
        return <Badge variant="secondary"><ClipboardCheck className="h-3 w-3 mr-1" />Submitted</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-orange-500" />
            Weekly COGS Wizard
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Record weekly stocktake for fresh items (Chicken, Vegetables, Oil, Milk)
          </p>
        </div>

        <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <ClipboardCheck className="h-4 w-4" />
              New Weekly Count
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Weekly COGS Stocktake
              </DialogTitle>
              <DialogDescription>
                Count closing stock for weekly items to calculate COGS
              </DialogDescription>
            </DialogHeader>

            {/* Week Selection */}
            <div className="flex gap-2 mb-4">
              <Button
                variant={selectedWeek === 'current' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedWeek('current')}
                disabled={hasStocktakeForWeek(currentWeekEnd)}
              >
                Current Week
              </Button>
              <Button
                variant={selectedWeek === 'previous' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedWeek('previous')}
                disabled={hasStocktakeForWeek(subWeeks(currentWeekEnd, 1))}
              >
                Previous Week
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Calendar className="h-4 w-4" />
              Week: {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              {weekAlreadyDone && (
                <Badge variant="secondary" className="ml-2">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Already completed
                </Badge>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : weeklyItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No weekly items found.</p>
                <p className="text-sm">Seed sample inventory items first.</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">+ Purchases</TableHead>
                      <TableHead className="text-right">= Available</TableHead>
                      <TableHead className="text-right">Closing Count</TableHead>
                      <TableHead className="text-right">Consumption</TableHead>
                      <TableHead className="text-right">COGS Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyItems.map(item => {
                      const consumption = calculateConsumption(item);
                      const available = item.opening_qty + item.purchases_qty;
                      const closing = parseFloat(closingCounts[item.item_id] || '0');
                      const hasVariance = closing > available;
                      
                      return (
                        <TableRow key={item.item_id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.item_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.unit} @ {formatCurrency(item.unit_cost)}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {item.opening_qty.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.purchases_qty.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {available.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={closingCounts[item.item_id] || ''}
                              onChange={(e) => handleClosingChange(item.item_id, e.target.value)}
                              className={cn(
                                "w-24 text-right",
                                hasVariance && "border-destructive"
                              )}
                            />
                            {hasVariance && (
                              <div className="text-xs text-destructive mt-1">
                                Exceeds available
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {consumption.qty.toFixed(2)} {item.unit}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(consumption.value)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <Separator className="my-4" />

                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">Total Opening</div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(weeklyItems.reduce((s, i) => s + i.opening_value, 0))}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">+ Purchases</div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(weeklyItems.reduce((s, i) => s + i.purchases_value, 0))}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">- Closing</div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(weeklyItems.reduce((s, i) => {
                          const closing = parseFloat(closingCounts[i.item_id] || '0');
                          return s + (closing * i.unit_cost);
                        }, 0))}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-orange-500/30 bg-orange-500/5">
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">= Weekly COGS</div>
                      <div className="text-lg font-bold text-orange-600">
                        {formatCurrency(totalCOGS)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any observations about this week's inventory..."
                    rows={2}
                  />
                </div>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setWizardOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createStocktake.isPending || weeklyItems.length === 0 || weekAlreadyDone}
              >
                {createStocktake.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Stocktake
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Recent Stocktakes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Recent Weekly Stocktakes</CardTitle>
          <CardDescription>
            Review and post weekly COGS to the ledger
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stocktakesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : stocktakes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No weekly stocktakes yet.</p>
              <p className="text-sm">Create your first weekly count above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Count Date</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocktakes.map(stocktake => (
                  <TableRow key={stocktake.id}>
                    <TableCell>
                      <div className="font-medium">
                        {format(new Date(stocktake.week_start_date), 'MMM d')} - {format(new Date(stocktake.week_end_date), 'MMM d')}
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(new Date(stocktake.stocktake_date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(stocktake.total_opening_value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(stocktake.total_purchases_value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(stocktake.total_closing_value)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-orange-600">
                      {formatCurrency(stocktake.total_cogs)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(stocktake.status)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetails(stocktake)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Weekly Stocktake Details</DialogTitle>
            {selectedStocktake && (
              <DialogDescription>
                Week: {format(new Date(selectedStocktake.week_start_date), 'MMM d')} - {format(new Date(selectedStocktake.week_end_date), 'MMM d, yyyy')}
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedStocktake && (
            <>
              <div className="flex items-center gap-4 mb-4">
                {getStatusBadge(selectedStocktake.status)}
                {selectedStocktake.posted_at && (
                  <span className="text-sm text-muted-foreground">
                    Posted: {format(new Date(selectedStocktake.posted_at), 'MMM d, yyyy h:mm a')}
                  </span>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Consumption</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stocktakeItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.item_name}</div>
                        <div className="text-xs text-muted-foreground">{item.unit}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{item.opening_qty.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{formatCurrency(item.opening_value)}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{item.purchases_qty.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{formatCurrency(item.purchases_value)}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{item.closing_qty.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{formatCurrency(item.closing_value)}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.consumption_qty.toFixed(2)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right font-medium text-orange-600">
                        {formatCurrency(item.consumption_value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              {/* Totals */}
              <div className="flex justify-end">
                <div className="text-right space-y-1">
                  <div className="text-sm text-muted-foreground">
                    Total Opening: {formatCurrency(selectedStocktake.total_opening_value)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    + Purchases: {formatCurrency(selectedStocktake.total_purchases_value)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    - Closing: {formatCurrency(selectedStocktake.total_closing_value)}
                  </div>
                  <div className="text-lg font-bold text-orange-600">
                    = Weekly COGS: {formatCurrency(selectedStocktake.total_cogs)}
                  </div>
                </div>
              </div>

              {selectedStocktake.notes && (
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <div className="text-sm font-medium mb-1">Notes</div>
                  <div className="text-sm text-muted-foreground">{selectedStocktake.notes}</div>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Close
            </Button>
            {selectedStocktake?.status === 'submitted' && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="gap-2">
                    <BookCheck className="h-4 w-4" />
                    Post to Ledger
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Post Weekly COGS to Ledger?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create the following journal entry:
                      <div className="mt-3 p-3 bg-muted rounded-md font-mono text-sm">
                        <div>DR 5000 Cost of Food: {formatCurrency(selectedStocktake.total_cogs)}</div>
                        <div>CR 1200 Inventory - Food: {formatCurrency(selectedStocktake.total_cogs)}</div>
                      </div>
                      <div className="mt-3 text-amber-600 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        This action cannot be undone.
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handlePostToLedger} disabled={postToLedger.isPending}>
                      {postToLedger.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Post to Ledger
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
