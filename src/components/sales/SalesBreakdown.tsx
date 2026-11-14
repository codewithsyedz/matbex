import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { deleteSaleLine, editSaleLine } from "@/lib/api/pos";
import { useBranch } from "@/contexts/BranchContext";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { FileDown, Search, TrendingUp, Package, UtensilsCrossed, BarChart3, Pencil, Trash2, Receipt } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { exportToCSV } from "@/lib/exportUtils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface SalesItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  transaction_id: string;
  menu_item?: {
    id: string;
    name: string;
    category: string;
  };
  transaction?: {
    id: string;
    receipt_number: string | null;
    payment_method: string;
  };
}

interface MenuItemSummary {
  menuItemId: string;
  name: string;
  category: string;
  totalQuantity: number;
  totalRevenue: number;
  avgPrice: number;
  transactionCount: number;
}

interface CategorySummary {
  category: string;
  totalQuantity: number;
  totalRevenue: number;
  itemCount: number;
}

export function SalesBreakdown() {
  const { restaurant, hasRole } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const tz = restaurant?.timezone || "Asia/Riyadh";
  const { t } = useTranslation();
  const isOwner = hasRole("owner");
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"items" | "category" | "transactions">("items");
  const [sortBy, setSortBy] = useState<"quantity" | "revenue">("revenue");
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnitPrice, setEditUnitPrice] = useState("");

  // Fetch sales items with menu item and transaction details
  const { data: salesItems = [], isLoading } = useQuery({
    queryKey: ["sales-breakdown", restaurant?.id, branchId, tz, dateFrom, dateTo],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      const startBounds = getRestaurantDayBoundsUTC(parseISO(dateFrom), tz);
      const endBounds = getRestaurantDayBoundsUTC(parseISO(dateTo), tz);

      // Paginate: PostgREST caps a single response at 1000 rows, which silently
      // truncated long date ranges and under-counted quantities/revenue.
      const PAGE_SIZE = 1000;
      const all: SalesItem[] = [];

      for (let page = 0; ; page += 1) {
        let query = db
          .from("sales_items")
          .select(`
            id,
            menu_item_id,
            quantity,
            unit_price,
            total_price,
            created_at,
            transaction_id,
            menu_item:menu_items(id, name, category),
            transaction:sales_transactions(id, receipt_number, payment_method)
          `)
          .eq("restaurant_id", restaurant.id)
          .gte("created_at", startBounds.start.toISOString())
          .lt("created_at", endBounds.endExclusive.toISOString());
        if (branchId) query = query.eq("branch_id", branchId);

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (error) throw error;
        const rows = (data ?? []) as SalesItem[];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
        if (page > 50) break; // hard safety stop
      }

      return all;
    },
    enabled: !!restaurant?.id,
  });

  // Update sales item mutation
  const updateMutation = useMutation({
    // PATCH /api/v1/pos/sales/:id/lines/:lineId: stock, food cost, sale totals and the drawer
    // follow the new quantity/price (a direct row update changed none of them).
    mutationFn: async ({ id, transactionId, quantity, unitPrice }: { id: string; transactionId: string; quantity: number; unitPrice: number }) => {
      if (!restaurant?.id) throw new Error("Missing restaurant context");
      await editSaleLine(transactionId, id, { restaurantId: restaurant.id, quantity, unitPrice });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      toast.success(t("app.salesBreakdown.itemUpdated"));
      setEditDialogOpen(false);
      setEditingItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message || t("app.salesBreakdown.updateFailed"));
    },
  });

  // Delete sales item mutation
  const deleteMutation = useMutation({
    // DELETE /api/v1/pos/sales/:id/lines/:lineId (the last line of a sale: void the sale instead).
    mutationFn: async ({ id, transactionId }: { id: string; transactionId: string }) => {
      if (!restaurant?.id) throw new Error("Missing restaurant context");
      await deleteSaleLine(transactionId, id, restaurant.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      toast.success(t("app.salesBreakdown.itemDeleted"));
    },
    onError: (error: any) => {
      toast.error(error.message || t("app.salesBreakdown.deleteFailed"));
    },
  });

  const handleEdit = (item: SalesItem) => {
    setEditingItem(item);
    setEditQuantity(item.quantity.toString());
    setEditUnitPrice(item.unit_price.toString());
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingItem) return;
    const quantity = parseInt(editQuantity);
    const unitPrice = parseFloat(editUnitPrice);
    if (isNaN(quantity) || quantity <= 0 || isNaN(unitPrice) || unitPrice <= 0) {
      toast.error(t("app.salesBreakdown.invalidValues"));
      return;
    }
    updateMutation.mutate({ id: editingItem.id, transactionId: editingItem.transaction_id, quantity, unitPrice });
  };

  const handleDelete = (item: SalesItem) => {
    deleteMutation.mutate({ id: item.id, transactionId: item.transaction_id });
  };

  // Calculate item-wise summary
  const itemSummary = useMemo(() => {
    const summary = new Map<string, MenuItemSummary>();
    
    salesItems.forEach((item) => {
      const menuItem = item.menu_item;
      if (!menuItem) return;
      
      const existing = summary.get(item.menu_item_id);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.totalRevenue += item.total_price;
        existing.transactionCount += 1;
        existing.avgPrice = existing.totalRevenue / existing.totalQuantity;
      } else {
        summary.set(item.menu_item_id, {
          menuItemId: item.menu_item_id,
          name: menuItem.name,
          category: menuItem.category || "Uncategorized",
          totalQuantity: item.quantity,
          totalRevenue: item.total_price,
          avgPrice: item.unit_price,
          transactionCount: 1,
        });
      }
    });
    
    return Array.from(summary.values());
  }, [salesItems]);

  // Calculate category-wise summary
  const categorySummary = useMemo(() => {
    const summary = new Map<string, CategorySummary>();
    
    itemSummary.forEach((item) => {
      const existing = summary.get(item.category);
      if (existing) {
        existing.totalQuantity += item.totalQuantity;
        existing.totalRevenue += item.totalRevenue;
        existing.itemCount += 1;
      } else {
        summary.set(item.category, {
          category: item.category,
          totalQuantity: item.totalQuantity,
          totalRevenue: item.totalRevenue,
          itemCount: 1,
        });
      }
    });
    
    return Array.from(summary.values());
  }, [itemSummary]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let items = [...itemSummary];
    
    if (searchTerm) {
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    items.sort((a, b) => {
      if (sortBy === "revenue") {
        return b.totalRevenue - a.totalRevenue;
      }
      return b.totalQuantity - a.totalQuantity;
    });
    
    return items;
  }, [itemSummary, searchTerm, sortBy]);

  // Filter and sort categories
  const filteredCategories = useMemo(() => {
    let categories = [...categorySummary];
    
    if (searchTerm) {
      categories = categories.filter((cat) =>
        cat.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    categories.sort((a, b) => {
      if (sortBy === "revenue") {
        return b.totalRevenue - a.totalRevenue;
      }
      return b.totalQuantity - a.totalQuantity;
    });
    
    return categories;
  }, [categorySummary, searchTerm, sortBy]);

  // Stats
  const totalRevenue = itemSummary.reduce((sum, item) => sum + item.totalRevenue, 0);
  const totalQuantity = itemSummary.reduce((sum, item) => sum + item.totalQuantity, 0);
  const uniqueItems = itemSummary.length;
  const topItem = filteredItems[0];

  // Export functions
  const handleExportItems = () => {
    const headers = ["Item Name", "Category", "Quantity Sold", "Total Revenue", "Avg Price", "Transactions"];
    const rows = filteredItems.map((item) => [
      item.name,
      item.category,
      item.totalQuantity,
      item.totalRevenue.toFixed(2),
      item.avgPrice.toFixed(2),
      item.transactionCount,
    ]);
    exportToCSV({ headers, rows, filename: `Sales_Breakdown_Items_${dateFrom}_to_${dateTo}` });
    toast.success(t("app.salesBreakdown.itemsCsvExported"));
  };

  const handleExportCategories = () => {
    const headers = ["Category", "Items Sold", "Total Quantity", "Total Revenue"];
    const rows = filteredCategories.map((cat) => [
      cat.category,
      cat.itemCount,
      cat.totalQuantity,
      cat.totalRevenue.toFixed(2),
    ]);
    exportToCSV({ headers, rows, filename: `Sales_Breakdown_Categories_${dateFrom}_to_${dateTo}` });
    toast.success(t("app.salesBreakdown.categoriesCsvExported"));
  };

  const categoryColors: Record<string, string> = {
    main: "bg-blue-500/10 text-blue-600",
    appetizer: "bg-amber-500/10 text-amber-600",
    dessert: "bg-pink-500/10 text-pink-600",
    beverage: "bg-cyan-500/10 text-cyan-600",
    side: "bg-green-500/10 text-green-600",
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>{t("app.salesBreakdown.from")}</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("app.salesBreakdown.to")}</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("app.salesBreakdown.search")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select value={viewMode} onValueChange={(v) => setViewMode(v as "items" | "category" | "transactions")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="items">{t("app.salesBreakdown.byItem")}</SelectItem>
            <SelectItem value="category">{t("app.salesBreakdown.byCategory")}</SelectItem>
            <SelectItem value="transactions">{t("app.salesBreakdown.transactions")}</SelectItem>
          </SelectContent>
        </Select>
        {viewMode !== "transactions" && (
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "quantity" | "revenue")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="revenue">{t("app.salesBreakdown.sortRevenue")}</SelectItem>
              <SelectItem value="quantity">{t("app.salesBreakdown.sortQuantity")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={viewMode === "items" ? handleExportItems : handleExportCategories}
          disabled={isLoading || viewMode === "transactions" || (viewMode === "items" ? filteredItems.length === 0 : filteredCategories.length === 0)}
        >
          <FileDown className="h-4 w-4 mr-2" />
          {t("app.salesBreakdown.export")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("app.salesBreakdown.totalRevenue")}</p>
                <p className="text-2xl font-semibold">{formatCurrency(totalRevenue)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("app.salesBreakdown.itemsSold")}</p>
                <p className="text-2xl font-semibold">{totalQuantity}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("app.salesBreakdown.uniqueItems")}</p>
                <p className="text-2xl font-semibold">{uniqueItems}</p>
              </div>
              <UtensilsCrossed className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t("app.salesBreakdown.topSeller")}</p>
                <p className="text-lg font-semibold truncate" title={topItem?.name}>
                  {topItem?.name || "-"}
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            {viewMode === "items" ? (
              <>
                <UtensilsCrossed className="h-5 w-5" />
                {t("app.salesBreakdown.itemBreakdown")}
              </>
            ) : viewMode === "category" ? (
              <>
                <BarChart3 className="h-5 w-5" />
                {t("app.salesBreakdown.categoryBreakdown")}
              </>
            ) : (
              <>
                <Receipt className="h-5 w-5" />
                {t("app.salesBreakdown.transactionDetails")}
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">{t("app.salesBreakdown.loading")}</p>
            </div>
          ) : viewMode === "transactions" ? (
            salesItems.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-muted-foreground">{t("app.salesBreakdown.noTransactions")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("app.salesBreakdown.col.date")}</TableHead>
                    <TableHead>{t("app.salesBreakdown.col.receipt")}</TableHead>
                    <TableHead>{t("app.salesBreakdown.col.item")}</TableHead>
                    <TableHead>{t("app.salesBreakdown.col.category")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.qty")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.unitPrice")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.total")}</TableHead>
                    {isOwner && <TableHead className="text-right">{t("app.salesBreakdown.col.actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesItems.filter(item => 
                    !searchTerm || 
                    item.menu_item?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    item.menu_item?.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    item.transaction?.receipt_number?.toLowerCase().includes(searchTerm.toLowerCase())
                  ).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(parseISO(item.created_at), "MMM dd, HH:mm")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.transaction?.receipt_number || "-"}
                      </TableCell>
                      <TableCell className="font-medium">{item.menu_item?.name || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={categoryColors[(item.menu_item?.category || "").toLowerCase()] || ""}
                        >
                          {item.menu_item?.category || "Uncategorized"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.total_price)}</TableCell>
                      {isOwner && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("app.salesBreakdown.deleteTitle")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("app.salesBreakdown.deleteDesc", { name: item.menu_item?.name ?? "" })}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("app.salesBreakdown.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => handleDelete(item)}
                                  >
                                    {t("app.salesBreakdown.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : viewMode === "items" ? (
            filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-muted-foreground">{t("app.salesBreakdown.noSales")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("app.salesBreakdown.col.item")}</TableHead>
                    <TableHead>{t("app.salesBreakdown.col.category")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.qtySold")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.avgPrice")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.totalRevenue")}</TableHead>
                    <TableHead className="text-right">{t("app.salesBreakdown.col.pctOfTotal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.menuItemId}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={categoryColors[item.category.toLowerCase()] || ""}
                        >
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{item.totalQuantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.avgPrice)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.totalRevenue)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {totalRevenue > 0 ? ((item.totalRevenue / totalRevenue) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : filteredCategories.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">{t("app.salesBreakdown.noSales")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("app.salesBreakdown.col.category")}</TableHead>
                  <TableHead className="text-right">{t("app.salesBreakdown.col.items")}</TableHead>
                  <TableHead className="text-right">{t("app.salesBreakdown.col.qtySold")}</TableHead>
                  <TableHead className="text-right">{t("app.salesBreakdown.col.totalRevenue")}</TableHead>
                  <TableHead className="text-right">{t("app.salesBreakdown.col.pctOfTotal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories.map((cat) => (
                  <TableRow key={cat.category}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={categoryColors[cat.category.toLowerCase()] || ""}
                      >
                        {cat.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{cat.itemCount}</TableCell>
                    <TableCell className="text-right">{cat.totalQuantity}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(cat.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {totalRevenue > 0 ? ((cat.totalRevenue / totalRevenue) * 100).toFixed(1) : 0}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.salesBreakdown.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("app.salesBreakdown.editDesc", { name: editingItem?.menu_item?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-quantity">{t("app.salesBreakdown.quantity")}</Label>
              <Input
                id="edit-quantity"
                type="number"
                min="1"
                value={editQuantity}
                onChange={(e) => setEditQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-price">{t("app.salesBreakdown.unitPrice")}</Label>
              <Input
                id="edit-price"
                type="number"
                min="0"
                step="0.01"
                value={editUnitPrice}
                onChange={(e) => setEditUnitPrice(e.target.value)}
              />
            </div>
            <div className="pt-2 text-sm text-muted-foreground">
              {t("app.salesBreakdown.total", { value: formatCurrency((parseInt(editQuantity) || 0) * (parseFloat(editUnitPrice) || 0)) })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t("app.salesBreakdown.cancel")}</Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t("app.salesBreakdown.saving") : t("app.salesBreakdown.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
