import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, ArrowDownRight, ArrowUpRight, Search, AlertTriangle, Package, Receipt,
} from "lucide-react";
import { format as fmtDate } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 200;

export default function InventoryAudit() {
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const restaurantId = restaurant?.id;
  const [search, setSearch] = useState("");
  const { t } = useTranslation();

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("reports.inventoryAudit.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("reports.inventoryAudit.description")}
            </p>
          </div>
        </div>

        <div className="relative w-full max-w-sm">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("reports.inventoryAudit.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-8"
          />
        </div>

        <Tabs defaultValue="movements">
          <TabsList>
            <TabsTrigger value="movements">
              <Package className="h-4 w-4 me-1.5" /> {t("reports.inventoryAudit.tabs.movements")}
            </TabsTrigger>
            <TabsTrigger value="wac">
              <Receipt className="h-4 w-4 me-1.5" /> {t("reports.inventoryAudit.tabs.wac")}
            </TabsTrigger>
            <TabsTrigger value="cogs">
              <Activity className="h-4 w-4 me-1.5" /> {t("reports.inventoryAudit.tabs.cogs")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="movements" className="mt-4">
            <MovementsTab restaurantId={restaurantId} search={search} />
          </TabsContent>
          <TabsContent value="wac" className="mt-4">
            <WacTab restaurantId={restaurantId} search={search} format={format} />
          </TabsContent>
          <TabsContent value="cogs" className="mt-4">
            <CogsTab restaurantId={restaurantId} search={search} format={format} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ----------------------------- Stock movements ----------------------------- */
function MovementsTab({ restaurantId, search }: { restaurantId?: string; search: string }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;
  const { data = [], isLoading } = useQuery({
    queryKey: ["audit-movements", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, created_at, movement_type, quantity_change, stock_before, stock_after, reason, reference_type, reference_id, inventory_item_id, inventory_items(name, unit)")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((r: any) =>
      !q ||
      (r.inventory_items?.name ?? "").toLowerCase().includes(q) ||
      (r.reference_type ?? "").toLowerCase().includes(q) ||
      (r.reason ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          {t("reports.inventoryAudit.latestMovements", { count: PAGE_SIZE })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[70vh]">
          {isLoading ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.inventoryAudit.columns.when")}</TableHead>
                  <TableHead>{t("reports.inventoryAudit.columns.item")}</TableHead>
                  <TableHead>{t("reports.inventoryAudit.columns.type")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.quantityChange")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.beforeAfter")}</TableHead>
                  <TableHead>{t("reports.inventoryAudit.columns.reasonRef")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r: any) => {
                  const delta = Number(r.quantity_change);
                  const negativeAfter = Number(r.stock_after) < 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(new Date(r.created_at), "PPp", { locale: dateLocale })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.inventory_items?.name ?? "-"}
                        <span className="text-xs text-muted-foreground ms-1">
                          {r.inventory_items?.unit}
                        </span>
                      </TableCell>
                      <TableCell>
                        <MovementTypeBadge type={r.movement_type} />
                      </TableCell>
                      <TableCell className={`text-end font-mono ${delta < 0 ? "text-destructive" : "text-primary"}`}>
                        {delta > 0 ? "+" : ""}{delta}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs">
                        {Number(r.stock_before).toFixed(2)} →{" "}
                        <span className={negativeAfter ? "text-destructive font-medium" : ""}>
                          {Number(r.stock_after).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.reason}
                        {r.reference_type && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {r.reference_type}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function MovementTypeBadge({ type }: { type: string }) {
  const isOut = ["sale_consumption", "consumption", "waste", "spoilage"].includes(type);
  const isReversal = type === "sale_reversal";
  return (
    <Badge variant={isReversal ? "outline" : isOut ? "destructive" : "secondary"} className="text-[10px]">
      {isOut ? <ArrowDownRight className="h-3 w-3 me-1" /> : <ArrowUpRight className="h-3 w-3 me-1" />}
      {type}
    </Badge>
  );
}

/* ------------------------------- Purchases / WAC ------------------------------ */
function WacTab({ restaurantId, search, format }: { restaurantId?: string; search: string; format: (n: number) => string }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;
  // Fetch purchases joined with items
  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ["audit-purchases", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, created_at, received_at, quantity_received, unit_cost, total_cost, invoice_number, inventory_item_id, inventory_items(name, unit, unit_cost)")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  // Reconstruct per-item WAC progression by replaying purchases oldest→newest
  // grouped by inventory_item_id. We need the purchase's stock-before to be exact,
  // so derive from stock_movements of type purchase if available; otherwise show
  // the purchase unit_cost vs current WAC of the item.
  const { data: purchaseMovements = [] } = useQuery({
    queryKey: ["audit-purchase-movements", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("reference_id, stock_before, stock_after, quantity_change, inventory_item_id")
        .eq("restaurant_id", restaurantId)
        .eq("reference_type", "purchase")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  const movementByPurchase = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of purchaseMovements) m.set(r.reference_id, r);
    return m;
  }, [purchaseMovements]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return purchases.filter((r: any) =>
      !q ||
      (r.inventory_items?.name ?? "").toLowerCase().includes(q) ||
      (r.invoice_number ?? "").toLowerCase().includes(q)
    );
  }, [purchases, search]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          {t("reports.inventoryAudit.purchasesWac")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("reports.inventoryAudit.wacFormula")}
        </p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[70vh]">
          {isLoading ? <Loading /> : filtered.length === 0 ? <Empty /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.inventoryAudit.columns.date")}</TableHead>
                  <TableHead>{t("reports.inventoryAudit.columns.item")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.quantity")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.purchaseCost")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.total")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.stockAfter")}</TableHead>
                  <TableHead className="text-end">{t("reports.inventoryAudit.columns.currentWac")}</TableHead>
                  <TableHead>{t("reports.inventoryAudit.columns.invoice")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p: any) => {
                  const mv = movementByPurchase.get(p.id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(new Date(p.received_at ?? p.created_at), "PPp", { locale: dateLocale })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.inventory_items?.name ?? "-"}
                        <span className="text-xs text-muted-foreground ms-1">
                          {p.inventory_items?.unit}
                        </span>
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        +{Number(p.quantity_received)}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {format(Number(p.unit_cost ?? 0))}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {format(Number(p.total_cost ?? 0))}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs">
                        {mv ? Number(mv.stock_after).toFixed(2) : "-"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-primary">
                        {format(Number(p.inventory_items?.unit_cost ?? 0))}
                      </TableCell>
                      <TableCell className="text-xs">{p.invoice_number ?? "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Provisional COGS ----------------------------- */
function CogsTab({ restaurantId, search, format }: { restaurantId?: string; search: string; format: (n: number) => string }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;
  const { data = [], isLoading } = useQuery({
    queryKey: ["audit-prov-cogs", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provisional_cogs_postings" as any)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  // Enrich with menu_item + inventory_item names
  const ids = useMemo(() => {
    const inv = new Set<string>(), mi = new Set<string>();
    (data as any[]).forEach((r) => {
      if (r.inventory_item_id) inv.add(r.inventory_item_id);
      if (r.menu_item_id) mi.add(r.menu_item_id);
    });
    return { inv: Array.from(inv), mi: Array.from(mi) };
  }, [data]);

  const { data: invMap = {} } = useQuery({
    queryKey: ["audit-prov-cogs-inv", ids.inv],
    queryFn: async () => {
      if (!ids.inv.length) return {};
      const { data, error } = await supabase
        .from("inventory_items").select("id, name, unit").in("id", ids.inv);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r: any) => [r.id, r]));
    },
    enabled: ids.inv.length > 0,
  });

  const { data: miMap = {} } = useQuery({
    queryKey: ["audit-prov-cogs-menu", ids.mi],
    queryFn: async () => {
      if (!ids.mi.length) return {};
      const { data, error } = await supabase
        .from("menu_items").select("id, name").in("id", ids.mi);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r: any) => [r.id, r]));
    },
    enabled: ids.mi.length > 0,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data as any[]).filter((r) => {
      if (!q) return true;
      const inv = (invMap as any)[r.inventory_item_id]?.name ?? "";
      const mi = (miMap as any)[r.menu_item_id]?.name ?? "";
      return inv.toLowerCase().includes(q) || mi.toLowerCase().includes(q);
    });
  }, [data, invMap, miMap, search]);

  // Summary
  const totals = useMemo(() => {
    let posted = 0, pending = 0, reversed = 0, neg = 0;
    (data as any[]).forEach((r) => {
      if (r.status === "posted") posted += Number(r.cogs_amount);
      else if (r.status === "pending") pending += Number(r.cogs_amount);
      else if (r.status === "reversed") reversed += Number(r.cogs_amount);
      if (r.is_negative_stock) neg += 1;
    });
    return { posted, pending, reversed, neg };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={t("reports.inventoryAudit.postedCogs")} value={format(totals.posted)} tone="primary" />
        <Stat label={t("reports.inventoryAudit.pending")} value={format(totals.pending)} tone="muted" />
        <Stat label={t("reports.inventoryAudit.reversed")} value={format(totals.reversed)} tone="muted" />
        <Stat
          label={t("reports.inventoryAudit.negativeFlags")}
          value={String(totals.neg)}
          tone={totals.neg > 0 ? "destructive" : "muted"}
          icon={totals.neg > 0 ? <AlertTriangle className="h-4 w-4" /> : null}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {t("reports.inventoryAudit.latestCogs")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("reports.inventoryAudit.cogsDescription")}
          </p>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[60vh]">
            {isLoading ? <Loading /> : filtered.length === 0 ? <Empty /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reports.inventoryAudit.columns.when")}</TableHead>
                    <TableHead>{t("reports.inventoryAudit.columns.menuItem")}</TableHead>
                    <TableHead>{t("reports.inventoryAudit.columns.ingredient")}</TableHead>
                    <TableHead className="text-end">{t("reports.inventoryAudit.columns.quantity")}</TableHead>
                    <TableHead className="text-end">{t("reports.inventoryAudit.columns.unitCost")}</TableHead>
                    <TableHead className="text-end">{t("reports.inventoryAudit.columns.cogs")}</TableHead>
                    <TableHead>{t("reports.inventoryAudit.columns.accounts")}</TableHead>
                    <TableHead>{t("reports.inventoryAudit.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(new Date(r.created_at), "PPp", { locale: dateLocale })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {(miMap as any)[r.menu_item_id]?.name ?? "-"}
                      </TableCell>
                      <TableCell>
                        {(invMap as any)[r.inventory_item_id]?.name ?? "-"}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {Number(r.qty_consumed)}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {format(Number(r.unit_cost_at_sale ?? 0))}
                      </TableCell>
                      <TableCell className="text-end font-mono text-primary">
                        {format(Number(r.cogs_amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {r.cogs_account_code} / {r.inventory_account_code}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} negative={r.is_negative_stock} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status, negative }: { status: string; negative: boolean }) {
  const { t } = useTranslation();
  const variant =
    status === "posted" ? "default" :
    status === "reversed" ? "outline" :
    status === "negative_stock_flag" ? "destructive" :
    "secondary";
  return (
    <div className="flex gap-1">
      <Badge variant={variant as any} className="text-[10px]">{t(`reports.inventoryAudit.statuses.${status}`, { defaultValue: status })}</Badge>
      {negative && status !== "negative_stock_flag" && (
        <Badge variant="destructive" className="text-[10px]">{t("reports.inventoryAudit.statuses.negative")}</Badge>
      )}
    </div>
  );
}

function Stat({
  label, value, tone, icon,
}: { label: string; value: string; tone: "primary" | "muted" | "destructive"; icon?: React.ReactNode }) {
  const color =
    tone === "primary" ? "text-primary" :
    tone === "destructive" ? "text-destructive" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-light flex items-center gap-2 mt-1 ${color}`}>
          {icon} {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Loading() {
  const { t } = useTranslation();
  return <div className="text-sm text-muted-foreground py-8 text-center">{t("reports.inventoryAudit.loading")}</div>;
}
function Empty() {
  const { t } = useTranslation();
  return <div className="text-sm text-muted-foreground py-8 text-center">{t("reports.inventoryAudit.empty")}</div>;
}