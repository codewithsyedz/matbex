import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Package, AlertTriangle, Pencil, Trash2, Download, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast as sonnerToast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { PurchaseTracker } from "@/components/inventory/PurchaseTracker";
import { SupplierManager } from "@/components/inventory/SupplierManager";
import { WasteTracker } from "@/components/inventory/WasteTracker";
import { InventoryValuationReport } from "@/components/inventory/InventoryValuationReport";
import { InventoryUsageTracker } from "@/components/inventory/InventoryUsageTracker";
import { StocktakeManager } from "@/components/inventory/StocktakeManager";
import { BatchTracker } from "@/components/inventory/BatchTracker";
import { InvoiceManager } from "@/components/inventory/InvoiceManager";
import { ReorderRequestsList } from "@/components/inventory/ReorderRequestsList";
import { InventorySettings } from "@/components/inventory/InventorySettings";
import { SupplierPayments } from "@/components/inventory/SupplierPayments";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { InventoryCSVImport } from "@/components/inventory/InventoryCSVImport";
import { exportInventoryToCSV } from "@/lib/inventoryExportUtils";
import { WeeklyCOGSWizard } from "@/components/inventory/WeeklyCOGSWizard";
import { InventoryCategoryManager } from "@/components/inventory/InventoryCategoryManager";
import { StockMovementsLog } from "@/components/inventory/StockMovementsLog";
import { canAddInventory } from "@/lib/accountantCorrections";
import { useBranch } from "@/contexts/BranchContext";

type CogsFrequency = "daily" | "weekly" | "monthly";

interface InventoryItem {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  unit_cost: number;
  vat_percentage: number;
  reorder_level: number | null;
  supplier_id: string | null;
  updated_at: string;
  cogs_frequency?: CogsFrequency;
  inventory_account_code?: string;
  cogs_account_code?: string;
  category?: string | null;
  units_per_pack?: number | null;
  stock_unit?: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

interface InventoryCategory {
  id: string;
  name: string;
  cogs_frequency: CogsFrequency;
  inventory_account_code: string;
  cogs_account_code: string;
}

/**
 * Plan gate. The screen itself is a separate component so its hooks always run in the same
 * order: returning the locked screen before them broke the rules of hooks and crashed the
 * page ("Rendered more hooks than during the previous render") when the plan's features
 * changed while it was open.
 */
export default function Inventory() {
  const { hasFeature, loading: authLoading } = useAuth();
  const { t } = useTranslation();

  // Show locked screen if inventory feature is not enabled
  if (!authLoading && !hasFeature("inventory")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName={t("app.inventory.locked.title")} 
          description={t("app.inventory.locked.description")}
          featureKey="inventory"
        />
      </>
    );
  }

  return <InventoryScreen />;
}

function InventoryScreen() {
  const { restaurant, isManager, hasRole, hasFeature, loading: authLoading } = useAuth();
  const { activeBranchId } = useBranch();
  const canCreateInventory = canAddInventory(hasRole);
  const { t } = useTranslation();


  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [unit, setUnit] = useState("unit");
  const [unitCost, setUnitCost] = useState("");
  const [vatPercentage, setVatPercentage] = useState("15");
  const [reorderLevel, setReorderLevel] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState("");
  const [cogsFrequency, setCogsFrequency] = useState<CogsFrequency>("monthly");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [stockUnit, setStockUnit] = useState("");

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [itemsRes, suppliersRes, categoriesRes] = await Promise.all([
        db
          .from("inventory_items")
          .select("*")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
        db
          .from("suppliers")
          .select("id, name")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
        db
          .from("inventory_categories")
          .select("*")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      setItems(itemsRes.data || []);
      setSuppliers(suppliersRes.data || []);
      setCategories(categoriesRes.data || []);
    } catch (error) {
      console.error("Error fetching inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!canCreateInventory || (editingItem && !isManager)) return;
    if (!name.trim() || !restaurant?.id) {
      toast({ title: t("common.error"), description: t("app.inventory.toasts.nameRequired"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Get account codes based on selected category from database
      const selectedCategory = categories.find(c => c.name === category);
      const inventoryCode = selectedCategory?.inventory_account_code || "1200";
      const cogsCode = selectedCategory?.cogs_account_code || "5000";

      const itemData = {
        name: name.trim(),
        current_stock: parseFloat(currentStock) || 0,
        unit: unit.trim() || "unit",
        unit_cost: parseFloat(unitCost) || 0,
        vat_percentage: parseFloat(vatPercentage) || 15,
        reorder_level: reorderLevel ? parseFloat(reorderLevel) : null,
        supplier_id: supplierId || null,
        restaurant_id: restaurant.id,
        cogs_frequency: selectedCategory?.cogs_frequency || cogsFrequency,
        inventory_account_code: inventoryCode,
        cogs_account_code: cogsCode,
        category: category || null,
        units_per_pack: parseFloat(unitsPerPack) || 1,
        stock_unit: stockUnit.trim() || null,
      };

      if (editingItem) {
        const { error } = await db
          .from("inventory_items")
          .update(itemData)
          .eq("id", editingItem.id);

        if (error) throw error;
        toast({ title: t("app.inventory.toasts.updated") });
      } else {
        const { error } = await db
          .from("inventory_items")
          .insert({ ...itemData, branch_id: activeBranchId && activeBranchId !== "all" ? activeBranchId : null });

        if (error) throw error;
        toast({ title: t("app.inventory.toasts.added") });
      }

      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving item:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    if (!confirm(t("app.inventory.confirmDelete", { name: item.name }))) return;

    try {
      const { error } = await db
        .from("inventory_items")
        .delete()
        .eq("id", item.id);

      if (error) throw error;
      toast({ title: t("app.inventory.toasts.deleted") });
      fetchData();
    } catch (error: any) {
      console.error("Error deleting item:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item);
    setName(item.name);
    setCurrentStock(item.current_stock.toString());
    setUnit(item.unit);
    setUnitCost(item.unit_cost.toString());
    setVatPercentage(item.vat_percentage.toString());
    setReorderLevel(item.reorder_level?.toString() || "");
    setSupplierId(item.supplier_id || "");
    setCogsFrequency(item.cogs_frequency || "monthly");
    setUnitsPerPack((item.units_per_pack ?? 1).toString());
    setStockUnit(item.stock_unit || "");
    // Load category from database, fallback to account code matching for legacy items
    if (item.category) {
      setCategory(item.category);
    } else if (item.cogs_account_code === "5010") {
      setCategory("Beverages");
    } else if (item.cogs_account_code === "5020") {
      setCategory("Packaging");
    } else {
      setCategory("");
    }
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
    setName("");
    setCurrentStock("");
    setUnit("unit");
    setUnitCost("");
    setVatPercentage("15");
    setReorderLevel("");
    setSupplierId("");
    setCategory("");
    setCogsFrequency("monthly");
    setUnitsPerPack("1");
    setStockUnit("");
  };

  const handleSeedSampleItems = async () => {
    if (!restaurant?.id) return;
    
    if (!confirm(t("app.inventory.seed.confirm"))) {
      return;
    }

    setSeeding(true);
    try {
      const { error } = await db.rpc('seed_sample_inventory_items', {
        p_restaurant_id: restaurant.id
      });
      
      if (error) throw error;
      
      sonnerToast.success(t("app.inventory.seed.created"), {
        description: t("app.inventory.seed.createdDescription")
      });
      fetchData();
    } catch (error: any) {
      console.error("Error seeding items:", error);
      sonnerToast.error(t("app.inventory.seed.failed"), { description: error.message });
    } finally {
      setSeeding(false);
    }
  };

  const lowStockItems = items.filter(
    (item) => item.reorder_level && item.current_stock <= item.reorder_level
  );
  const totalValue = items.reduce(
    (sum, item) => sum + item.current_stock * item.unit_cost * (1 + item.vat_percentage / 100),
    0
  );

  const getStockStatus = (item: InventoryItem) => {
    if (!item.reorder_level) return "normal";
    if (item.current_stock <= 0) return "out";
    if (item.current_stock <= item.reorder_level) return "low";
    return "normal";
  };

  const getStockPercentage = (item: InventoryItem) => {
    if (!item.reorder_level) return 100;
    const max = item.reorder_level * 3;
    return Math.min((item.current_stock / max) * 100, 100);
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.inventory.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("app.inventory.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isManager && (
              <>
                {items.length === 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-dashed"
                    onClick={handleSeedSampleItems}
                    disabled={seeding}
                  >
                    <Sparkles className="h-4 w-4" />
                     {seeding ? t("app.inventory.actions.creating") : t("app.inventory.actions.seed")}
                  </Button>
                )}
                <InventoryCSVImport onImportComplete={fetchData} />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => exportInventoryToCSV(items, restaurant?.currency)}
                  disabled={items.length === 0}
                >
                  <Download className="h-4 w-4" />
                   {t("app.inventory.actions.export")}
                </Button>
              </>
            )}
            {canCreateInventory && (
              <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                     <span className="hidden sm:inline">{t("app.inventory.actions.add")}</span>
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                   <DialogTitle>{editingItem ? t("app.inventory.actions.edit") : t("app.inventory.actions.add")}</DialogTitle>
                  <DialogDescription>
                     {editingItem ? t("app.inventory.form.editDescription") : t("app.inventory.form.addDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.name")}</Label>
                      <Input
                         placeholder={t("app.inventory.form.namePlaceholder")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.category")}</Label>
                      <Select value={category} onValueChange={(val) => {
                        setCategory(val);
                        const cat = categories.find(c => c.name === val);
                        if (cat) setCogsFrequency(cat.cogs_frequency);
                      }}>
                        <SelectTrigger>
                           <SelectValue placeholder={t("app.inventory.form.selectCategory")} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.name}>
                               {cat.name} ({t(`app.inventory.frequency.${cat.cogs_frequency}`)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.currentStock")}</Label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={currentStock}
                        onChange={(e) => setCurrentStock(e.target.value)}
                        min="0"
                      />
                    </div>
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.unit")}</Label>
                      <Input
                         placeholder={t("app.inventory.form.unitPlaceholder")}
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.unitCost")} ({restaurant?.currency || "SAR"})</Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={unitCost}
                        onChange={(e) => setUnitCost(e.target.value)}
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.vat")}</Label>
                      <Input
                        type="number"
                        placeholder="15"
                        value={vatPercentage}
                        onChange={(e) => setVatPercentage(e.target.value)}
                        min="0"
                        max="100"
                        step="0.1"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                     <Label>{t("app.inventory.form.reorderLevel")}</Label>
                    <Input
                      type="number"
                       placeholder={t("common.optional")}
                      value={reorderLevel}
                      onChange={(e) => setReorderLevel(e.target.value)}
                      min="0"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.unitsPerPack")}</Label>
                      <Input
                        type="number"
                        placeholder="1"
                        value={unitsPerPack}
                        onChange={(e) => setUnitsPerPack(e.target.value)}
                        min="0.01"
                        step="0.01"
                      />
                      <p className="text-[11px] text-muted-foreground">
                         {t("app.inventory.form.unitsPerPackHelp")}
                      </p>
                    </div>
                    <div className="space-y-2">
                       <Label>{t("app.inventory.form.stockUnit")}</Label>
                      <Input
                         placeholder={unit || t("app.inventory.form.stockUnitPlaceholder")}
                        value={stockUnit}
                        onChange={(e) => setStockUnit(e.target.value)}
                      />
                      <p className="text-[11px] text-muted-foreground">
                         {t("app.inventory.form.stockUnitHelp")}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                     <Label>{t("app.inventory.form.supplier")}</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger>
                         <SelectValue placeholder={t("app.inventory.form.selectSupplier")} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button 
                    className="w-full" 
                    onClick={handleSave}
                    disabled={submitting || !name.trim()}
                  >
                     {submitting ? t("common.saving") : editingItem ? t("app.inventory.actions.update") : t("app.inventory.actions.add")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </header>

        {/* Stats Summary */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4 fade-slide-in" style={{ animationDelay: "50ms" }}>
          <div className="p-4 rounded-lg border bg-card">
             <p className="text-sm text-muted-foreground">{t("app.inventory.stats.totalItems")}</p>
            <p className="text-2xl font-semibold mt-1">{items.length}</p>
          </div>
          <div className="p-4 rounded-lg border bg-card">
             <p className="text-sm text-muted-foreground">{t("app.inventory.stats.value")}</p>
            <p className="text-2xl font-semibold mt-1">{totalValue.toFixed(2)} {restaurant?.currency || "SAR"}</p>
          </div>
           <div className={`p-4 rounded-lg border bg-card ${lowStockItems.length > 0 ? "border-warning/50" : ""}`}>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
               {lowStockItems.length > 0 && <AlertTriangle className="h-4 w-4 text-warning" />}
               {t("app.inventory.stats.lowStock")}
            </p>
            <p className="text-2xl font-semibold mt-1">{lowStockItems.length}</p>
          </div>
        </div>

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
           <div className="mt-6 p-4 rounded-lg border border-warning/50 bg-warning/5 fade-slide-in" style={{ animationDelay: "100ms" }}>
             <p className="text-sm font-medium flex items-center gap-2 text-warning mb-2">
              <AlertTriangle className="h-4 w-4" />
               {t("app.inventory.stats.belowReorder")}
            </p>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.map((item) => (
                 <Badge key={item.id} variant="outline" className="border-warning/50 text-warning">
                  {item.name}: {item.current_stock} {item.unit}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tabs for different sections */}
        <div className="mt-6 fade-slide-in" style={{ animationDelay: "150ms" }}>
          <Tabs defaultValue="items">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="items">{t("app.inventory.tabs.items")}</TabsTrigger>
              <TabsTrigger value="categories">{t("app.inventory.tabs.categories")}</TabsTrigger>
              <TabsTrigger value="batches">{t("app.inventory.tabs.batches")}</TabsTrigger>
               <TabsTrigger value="weekly-cogs" className="text-warning">{t("app.inventory.tabs.weeklyCogs")}</TabsTrigger>
              <TabsTrigger value="stocktake">{t("app.inventory.tabs.stocktake")}</TabsTrigger>
              <TabsTrigger value="purchases">{t("app.inventory.tabs.purchases")}</TabsTrigger>
              <TabsTrigger value="invoices">{t("app.inventory.tabs.invoices")}</TabsTrigger>
              <TabsTrigger value="waste">{t("app.inventory.tabs.waste")}</TabsTrigger>
              <TabsTrigger value="movements">{t("app.inventory.tabs.movements")}</TabsTrigger>
              <TabsTrigger value="suppliers">{t("app.inventory.tabs.suppliers")}</TabsTrigger>
              <TabsTrigger value="payments">{t("app.inventory.tabs.payments")}</TabsTrigger>
              <TabsTrigger value="reorders">{t("app.inventory.tabs.reorders")}</TabsTrigger>
              <TabsTrigger value="reports">{t("app.inventory.tabs.reports")}</TabsTrigger>
              <TabsTrigger value="settings">{t("app.inventory.tabs.settings")}</TabsTrigger>
            </TabsList>

            <TabsContent value="items" className="mt-4">
              {/* Inventory Table */}
              <div className="rounded-lg border bg-card">
                {loading ? (
                  <div className="flex items-center justify-center h-48">
                     <div className="text-muted-foreground">{t("common.loading")}</div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <Package className="h-10 w-10 text-muted-foreground mb-3" />
                     <p className="text-muted-foreground">{t("app.inventory.empty")}</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                         <TableHead>{t("app.inventory.table.item")}</TableHead>
                         <TableHead>{t("app.inventory.table.category")}</TableHead>
                         <TableHead>{t("app.inventory.table.stock")}</TableHead>
                         <TableHead>{t("app.inventory.table.unitCost")}</TableHead>
                         <TableHead>{t("app.inventory.table.vat")}</TableHead>
                         <TableHead>{t("app.inventory.table.totalValue")}</TableHead>
                         <TableHead>{t("app.inventory.table.status")}</TableHead>
                         {isManager && <TableHead className="w-20">{t("app.inventory.table.actions")}</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const status = getStockStatus(item);
                        const percentage = getStockPercentage(item);
                        
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>
                              {item.category ? (
                                <Badge variant="outline" className="font-normal">
                                  {item.category}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="text-sm">
                                  {item.current_stock} {item.unit}
                                </div>
                                {item.reorder_level && (
                                  <Progress 
                                    value={percentage} 
                                    className={`h-1.5 ${
                                      status === "out" ? "[&>div]:bg-red-500" :
                                      status === "low" ? "[&>div]:bg-amber-500" :
                                      "[&>div]:bg-emerald-500"
                                    }`}
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{item.unit_cost.toFixed(2)} {restaurant?.currency || "SAR"}</TableCell>
                            <TableCell>{item.vat_percentage}%</TableCell>
                            <TableCell className="font-medium">
                              {(item.current_stock * item.unit_cost * (1 + item.vat_percentage / 100)).toFixed(2)} {restaurant?.currency || "SAR"}
                            </TableCell>
                            <TableCell>
                              {status === "out" && (
                                 <Badge variant="destructive">{t("app.inventory.status.out")}</Badge>
                              )}
                              {status === "low" && (
                                <Badge variant="secondary" className="bg-warning/10 text-warning">
                                  {t("app.inventory.status.low")}
                                </Badge>
                              )}
                              {status === "normal" && (
                                <Badge variant="secondary" className="bg-success/10 text-success">
                                  {t("app.inventory.status.normal")}
                                </Badge>
                              )}
                            </TableCell>
                            {isManager && (
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => openEditDialog(item)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDelete(item)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

          <TabsContent value="categories">
            <InventoryCategoryManager />
          </TabsContent>

          <TabsContent value="batches">
            <BatchTracker />
          </TabsContent>

          <TabsContent value="weekly-cogs">
            <WeeklyCOGSWizard />
          </TabsContent>

          <TabsContent value="purchases">
            <PurchaseTracker />
          </TabsContent>

          <TabsContent value="invoices">
            <InvoiceManager />
          </TabsContent>

          <TabsContent value="waste">
            <WasteTracker />
          </TabsContent>

          <TabsContent value="movements">
            <StockMovementsLog />
          </TabsContent>

          <TabsContent value="suppliers">
            <SupplierManager />
          </TabsContent>

          <TabsContent value="payments">
            <SupplierPayments />
          </TabsContent>

          <TabsContent value="reorders">
            <ReorderRequestsList />
          </TabsContent>

          <TabsContent value="stocktake">
            <StocktakeManager />
          </TabsContent>

          <TabsContent value="reports">
            <InventoryValuationReport />
          </TabsContent>

          <TabsContent value="settings">
            <InventorySettings />
          </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
