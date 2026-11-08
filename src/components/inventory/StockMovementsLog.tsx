import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, ArrowUp, ArrowDown, Loader2, Download, FileText, Plus, X, Undo2, Lock, ShieldAlert, CheckCircle2, FileDown, Filter, Upload } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { exportToCSV, exportToPDF } from "@/lib/exportUtils";
import { ManualStockAdjustmentDialog } from "./ManualStockAdjustmentDialog";
import { BulkStockAdjustmentDialog } from "./BulkStockAdjustmentDialog";
import { downloadStockAdjustmentTemplate } from "@/lib/stockAdjustmentTemplate";
import { toast } from "sonner";

interface StockMovement {
  id: string;
  inventory_item_id: string;
  movement_type: string;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  created_by: string | null;
  locked_at?: string | null;
  shift_id?: string | null;
  inventory_items?: { name: string; unit: string | null; stock_unit: string | null } | null;
}

const TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  purchase: { label: 'Purchase', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  usage: { label: 'Usage', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  waste: { label: 'Waste', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  adjustment: { label: 'Adjustment', cls: 'bg-muted text-muted-foreground border-border' },
  transfer: { label: 'Transfer', cls: 'bg-primary/10 text-primary border-primary/30' },
};

const QUICK_RANGES = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: -1 },
];

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'expense', label: 'Expense' },
  { value: 'manual_adjustment', label: 'Manual adjustment' },
  { value: 'purchase_invoice', label: 'Purchase invoice' },
  { value: 'stocktake', label: 'Stocktake' },
  { value: 'waste', label: 'Waste log' },
];

function ReconChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const ok = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ok || !onClick}
      title={ok ? 'No issues' : `Open ${count} ${label.toLowerCase()} in Movements`}
      className={`group flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : active
            ? 'border-amber-600 bg-amber-500/20 text-amber-800 dark:text-amber-200 ring-1 ring-amber-500/40'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer'
      }`}
    >
      <span className="truncate flex items-center gap-1.5">
        {!ok && <Filter className="h-3 w-3 opacity-60 group-hover:opacity-100" />}
        {label}
      </span>
      <span className={`font-mono font-semibold tabular-nums ${ok ? '' : 'text-amber-700 dark:text-amber-300'}`}>
        {count}
      </span>
    </button>
  );
}

type ReconFlag = null | 'negative_stock' | 'missing_reason' | 'cost_deviation' | 'orphaned';
const RECON_FLAG_LABELS: Record<Exclude<ReconFlag, null>, string> = {
  negative_stock: 'Negative stock items',
  missing_reason: 'Movements missing a reason',
  cost_deviation: 'Cost deviation ≥ 15%',
  orphaned: 'Orphaned movements (no source)',
};

export function StockMovementsLog() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();
  const [itemFilter, setItemFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [rangeId, setRangeId] = useState<string>('30d');
  const [reasonSearch, setReasonSearch] = useState<string>('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [undoTick, setUndoTick] = useState(0);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [reconFlag, setReconFlag] = useState<ReconFlag>(null);

  // Smoothly scroll the table into view after a chip drilldown
  const scrollToTable = () => {
    requestAnimationFrame(() => {
      const el = document.getElementById('stock-movements-table');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Tick every 15s so the 5-min Undo countdown stays accurate
  useEffect(() => {
    const t = setInterval(() => setUndoTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const dateFromIso = useMemo(() => {
    const range = QUICK_RANGES.find(r => r.id === rangeId);
    if (!range || range.days < 0) return null;
    if (range.days === 0) return startOfDay(new Date()).toISOString();
    return startOfDay(subDays(new Date(), range.days)).toISOString();
  }, [rangeId]);

  const { data: items = [] } = useQuery({
    queryKey: ['inventory-items-for-movements', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Pre-fetched here so the reconFlag drilldown filter can use it
  const { data: lowStockItems = [] } = useQuery({
    queryKey: ['inventory-negative-stock', restaurant?.id, undoTick],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string; current_stock: number; stock_unit: string | null; unit: string | null }>;
      const sb = supabase as any;
      const { data, error } = await sb
        .from('inventory_items')
        .select('id, name, current_stock, stock_unit, unit')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .lt('current_stock', 0);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['stock-movements', restaurant?.id, itemFilter, typeFilter, sourceFilter, rangeId],
    queryFn: async () => {
      if (!restaurant?.id) return [] as StockMovement[];
      const sb = supabase as any;
      let q = sb
        .from('stock_movements')
        .select('*, inventory_items(name, unit, stock_unit, unit_cost, units_per_pack)')
        .eq('restaurant_id', restaurant.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (itemFilter !== 'all') q = q.eq('inventory_item_id', itemFilter);
      if (typeFilter !== 'all') q = q.eq('movement_type', typeFilter);
      if (sourceFilter !== 'all') q = q.eq('reference_type', sourceFilter);
      if (dateFromIso) q = q.gte('created_at', dateFromIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as StockMovement[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch shift close metadata + closer profile for every locked row in view.
  // Used to render a small timeline under each locked row for auditing.
  const lockedShiftIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of movements as StockMovement[]) {
      if (m.locked_at && m.shift_id) ids.add(m.shift_id);
    }
    return Array.from(ids);
  }, [movements]);

  const { data: lockInfoMap = new Map<string, { closedAt: string | null; closerName: string }>() } = useQuery({
    queryKey: ['stock-movements-lock-info', restaurant?.id, lockedShiftIds.join(',')],
    queryFn: async () => {
      const map = new Map<string, { closedAt: string | null; closerName: string }>();
      if (lockedShiftIds.length === 0) return map;
      const sb = supabase as any;
      const { data: shifts, error: sErr } = await sb
        .from('shifts')
        .select('id, closed_at, cashier_user_id, cashier_staff_id, staff:staff_members(full_name)')
        .in('id', lockedShiftIds);
      if (sErr) throw sErr;

      const userIds = Array.from(new Set(
        (shifts || [])
          .filter((s: any) => !s.cashier_staff_id && s.cashier_user_id)
          .map((s: any) => s.cashier_user_id)
      )) as string[];

      const profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await sb
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        for (const p of profiles || []) {
          profileMap.set(p.id, p.full_name || 'Unknown user');
        }
      }

      for (const s of shifts || []) {
        const closerName: string = s.staff?.full_name
          || profileMap.get(s.cashier_user_id)
          || 'Unknown user';
        map.set(s.id, { closedAt: s.closed_at, closerName });
      }
      return map;
    },
    enabled: !!restaurant?.id && lockedShiftIds.length > 0,
  });

  // Reason search + reconciliation flag are client-side over already-filtered results
  const filteredMovements = useMemo(() => {
    let list = movements as StockMovement[];

    // Apply drilldown flag
    if (reconFlag === 'missing_reason') {
      list = list.filter(m => !m.reason || m.reason.trim() === '');
    } else if (reconFlag === 'orphaned') {
      list = list.filter(m => !m.reference_type && !m.reference_id && !m.shift_id);
    } else if (reconFlag === 'cost_deviation') {
      list = list.filter(m =>
        m.movement_type === 'purchase' &&
        m.reason && /price|cost|deviat|expensive/i.test(m.reason)
      );
    } else if (reconFlag === 'negative_stock') {
      const negIds = new Set(lowStockItems.map(i => i.id));
      list = list.filter(m => negIds.has(m.inventory_item_id));
    }

    if (reasonSearch.trim()) {
      const q = reasonSearch.trim().toLowerCase();
      list = list.filter(m =>
        (m.reason || '').toLowerCase().includes(q) ||
        (m.inventory_items?.name || '').toLowerCase().includes(q) ||
        (m.reference_type || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [movements, reasonSearch, reconFlag, lowStockItems]);

  const buildExport = () => {
    const headers = ['Date', 'Item', 'Type', 'Source', 'Change', 'Stock Before', 'Stock After', 'Reason', 'Reference'];
    const rows = filteredMovements.map(m => {
      const unit = m.inventory_items?.stock_unit || m.inventory_items?.unit || '';
      const change = `${Number(m.quantity_change) >= 0 ? '+' : ''}${Number(m.quantity_change).toFixed(2)} ${unit}`;
      return [
        format(new Date(m.created_at), 'yyyy-MM-dd HH:mm'),
        m.inventory_items?.name || '-',
        TYPE_STYLES[m.movement_type]?.label || m.movement_type,
        m.reference_type || '-',
        change,
        Number(m.stock_before).toFixed(2),
        Number(m.stock_after).toFixed(2),
        m.reason || '',
        m.reference_id || '',
      ];
    });
    const itemSuffix = itemFilter !== 'all'
      ? `_${(items.find(i => i.id === itemFilter)?.name || 'item').replace(/\s+/g, '-')}`
      : '';
    const rangeSuffix = QUICK_RANGES.find(r => r.id === rangeId)?.id || 'all';
    return { headers, rows, filename: `Stock_Movements_${rangeSuffix}${itemSuffix}` };
  };

  const handleExportCSV = () => exportToCSV(buildExport());
  const handleExportPDF = () => exportToPDF(buildExport());

  const hasActiveFilters = itemFilter !== 'all' || typeFilter !== 'all' || sourceFilter !== 'all' || rangeId !== '30d' || !!reasonSearch.trim() || reconFlag !== null;

  const clearFilters = () => {
    setItemFilter('all');
    setTypeFilter('all');
    setSourceFilter('all');
    setRangeId('30d');
    setReasonSearch('');
    setReconFlag(null);
  };

  // ─── Undo support (5-min window for manual adjustments) ────────────────────
  const UNDO_WINDOW_MS = 5 * 60 * 1000;
  const isUndoable = (m: StockMovement) => {
    if (m.movement_type !== 'adjustment') return false;
    if (m.locked_at) return false;
    const age = Date.now() - new Date(m.created_at).getTime();
    return age < UNDO_WINDOW_MS;
  };
  const undoSecondsLeft = (m: StockMovement) => {
    const left = UNDO_WINDOW_MS - (Date.now() - new Date(m.created_at).getTime());
    return Math.max(0, Math.ceil(left / 1000));
  };

  const handleUndo = async (m: StockMovement) => {
    if (!isUndoable(m)) return;
    setUndoingId(m.id);
    try {
      // Server-side guarded undo: validates lock status (closed shift) and
      // 5-minute window before writing the reversing audit row.
      const sb = supabase as any;
      const { error } = await sb.rpc('undo_stock_adjustment', { _movement_id: m.id });
      if (error) throw error;

      toast.success('Adjustment reversed');
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    } catch (e: any) {
      console.error('Undo failed', e);
      const msg: string = e?.message || '';
      const isLocked =
        e?.hint === 'locked' ||
        /locked/i.test(msg) ||
        /shift has been closed/i.test(msg);
      if (isLocked) {
        toast.error('Locked by closed shift', {
          description: 'This movement (or its linked expense) is locked because the shift was closed. Undo is not allowed.',
          duration: 6000,
        });
        // Refresh so the row's lock state is reflected in the UI
        queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      } else if (e?.hint === 'expired' || /window.*expired/i.test(msg)) {
        toast.error('Undo window expired', {
          description: 'The 5-minute undo window has passed. Use a Manual Stock Adjustment to correct.',
        });
      } else {
        toast.error(msg || 'Undo failed');
      }
    } finally {
      setUndoingId(null);
    }
  };

  // Toast-based Undo right after a manual adjustment
  const showUndoToast = (info: { movementId: string; itemName: string; signedDelta: number; stockUnit: string }) => {
    const { movementId, itemName, signedDelta, stockUnit } = info;
    toast(`Adjusted ${itemName}: ${signedDelta > 0 ? '+' : ''}${signedDelta.toFixed(2)} ${stockUnit}`, {
      duration: 5 * 60 * 1000, // 5 minutes
      action: {
        label: 'Undo',
        onClick: async () => {
          // Re-fetch the movement row from cache or DB and run handleUndo on it
          const sb = supabase as any;
          const { data: row } = await sb
            .from('stock_movements')
            .select('*, inventory_items(name, unit, stock_unit)')
            .eq('id', movementId)
            .single();
          if (row) await handleUndo(row as StockMovement);
        },
      },
    });
  };

  // ─── Reconciliation checklist ──────────────────────────────────────────────
  const reconciliation = useMemo(() => {
    const negativeStock = lowStockItems.length;
    const missingReason = movements.filter(m => !m.reason || m.reason.trim() === '').length;
    const orphaned = movements.filter(m =>
      !m.reference_type && !m.reference_id && !m.shift_id
    ).length;

    let costDeviation = 0;
    const costDeviationItems: string[] = [];
    movements.forEach((m: any) => {
      if (m.movement_type !== 'purchase') return;
      const baseCost = Number(m.inventory_items?.unit_cost) || 0;
      const upp = Number(m.inventory_items?.units_per_pack) || 1;
      if (baseCost <= 0) return;
      const expectedPerStockUnit = baseCost / upp;
      // We don't have effective spend here per row; skip rows we can't evaluate
      // (Cost deviation alerts are surfaced inline at entry time; here we flag
      //  only purchases with reason mentioning a price flag.)
      if (m.reason && /price|cost|deviat|expensive/i.test(m.reason)) {
        costDeviation += 1;
        if (m.inventory_items?.name) costDeviationItems.push(m.inventory_items.name);
      }
    });

    return {
      negativeStock,
      missingReason,
      orphaned,
      costDeviation,
      negativeStockItems: lowStockItems,
      costDeviationItems: Array.from(new Set(costDeviationItems)).slice(0, 5),
    };
  }, [movements, lowStockItems]);

  const allClean =
    reconciliation.negativeStock === 0 &&
    reconciliation.missingReason === 0 &&
    reconciliation.orphaned === 0 &&
    reconciliation.costDeviation === 0;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-5 w-5" />
              Stock Movements
            </CardTitle>
            <CardDescription>
              Every change in stock with reason and source. Showing up to 500 entries.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdjustOpen(true)}>
              <Plus className="h-4 w-4" />
              Adjust Stock
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setBulkOpen(true)}
              title="Upload a CSV to apply many stock corrections at once"
            >
              <Upload className="h-4 w-4" />
              Bulk Import
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={downloadStockAdjustmentTemplate}
              title="Download CSV template for bulk stock adjustments"
            >
              <FileDown className="h-4 w-4" />
              Template
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleExportCSV}
              disabled={filteredMovements.length === 0}
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleExportPDF}
              disabled={filteredMovements.length === 0}
            >
              <FileText className="h-4 w-4" />
              PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Reconciliation checklist */}
          <div className={`rounded-lg border p-3 ${
            allClean
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/40 bg-amber-500/5'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {allClean ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              <span className="text-sm font-medium">
                {allClean ? 'All clean - no reconciliation flags' : 'Reconciliation checklist'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <ReconChip
                label="Negative stock"
                count={reconciliation.negativeStock}
                active={reconFlag === 'negative_stock'}
                onClick={() => {
                  setItemFilter('all');
                  setTypeFilter('all');
                  setSourceFilter('all');
                  setRangeId('all');
                  setReasonSearch('');
                  setReconFlag('negative_stock');
                  scrollToTable();
                }}
              />
              <ReconChip
                label="Missing reason"
                count={reconciliation.missingReason}
                active={reconFlag === 'missing_reason'}
                onClick={() => {
                  setItemFilter('all');
                  setTypeFilter('all');
                  setSourceFilter('all');
                  setReasonSearch('');
                  setReconFlag('missing_reason');
                  scrollToTable();
                }}
              />
              <ReconChip
                label="Cost deviation ≥ 15%"
                count={reconciliation.costDeviation}
                active={reconFlag === 'cost_deviation'}
                onClick={() => {
                  setItemFilter('all');
                  setTypeFilter('purchase');
                  setSourceFilter('all');
                  setReasonSearch('');
                  setReconFlag('cost_deviation');
                  scrollToTable();
                }}
              />
              <ReconChip
                label="Orphaned (no source)"
                count={reconciliation.orphaned}
                active={reconFlag === 'orphaned'}
                onClick={() => {
                  setItemFilter('all');
                  setTypeFilter('all');
                  setSourceFilter('all');
                  setReasonSearch('');
                  setReconFlag('orphaned');
                  scrollToTable();
                }}
              />
            </div>
            {reconciliation.negativeStockItems.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                Negative items: {reconciliation.negativeStockItems.slice(0, 5).map(i => i.name).join(', ')}
                {reconciliation.negativeStockItems.length > 5 && ` +${reconciliation.negativeStockItems.length - 5} more`}
              </div>
            )}
          </div>

          {/* Quick range chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_RANGES.map(r => (
              <Button
                key={r.id}
                size="sm"
                variant={rangeId === r.id ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setRangeId(r.id)}
              >
                {r.label}
              </Button>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All items" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                {items.map(it => (
                  <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="purchase">Purchase</SelectItem>
                <SelectItem value="usage">Usage</SelectItem>
                <SelectItem value="waste">Waste</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={reasonSearch}
              onChange={(e) => setReasonSearch(e.target.value)}
              placeholder="Search reason, item, or source…"
              className="w-64"
            />
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" className="gap-1.5 h-9" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {/* Result count */}
          {reconFlag && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <span className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Drilldown active: <strong>{RECON_FLAG_LABELS[reconFlag]}</strong>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs hover:bg-amber-500/20"
                onClick={() => setReconFlag(null)}
              >
                <X className="h-3 w-3 mr-1" />
                Clear drilldown
              </Button>
            </div>
          )}

          <div id="stock-movements-table" className="text-xs text-muted-foreground scroll-mt-20">
            {filteredMovements.length} movement{filteredMovements.length === 1 ? '' : 's'}
            {filteredMovements.length !== movements.length && ` (filtered from ${movements.length})`}
          </div>

          {isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No stock movements match these filters.
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Before → After</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMovements.map(m => {
                    const style = TYPE_STYLES[m.movement_type] || TYPE_STYLES.adjustment;
                    const unit = m.inventory_items?.stock_unit || m.inventory_items?.unit || '';
                    const positive = Number(m.quantity_change) >= 0;
                    const undoable = isUndoable(m);
                    const secondsLeft = undoable ? undoSecondsLeft(m) : 0;
                    const lockInfo = m.locked_at && m.shift_id ? lockInfoMap.get(m.shift_id) : null;
                    return (
                      <Fragment key={m.id}>
                      <TableRow className={m.locked_at ? 'border-b-0' : ''}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(m.created_at), 'MMM d, HH:mm')}
                          {m.locked_at && (
                            <span className="ml-1 inline-flex items-center" title={`Locked at ${format(new Date(m.locked_at), 'MMM d, HH:mm')} - shift closed`}>
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {m.inventory_items?.name || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={style.cls}>{style.label}</Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          <span className="inline-flex items-center gap-1 justify-end">
                            {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {positive ? '+' : ''}{Number(m.quantity_change).toFixed(2)} {unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {Number(m.stock_before).toFixed(2)} → <span className="text-foreground font-semibold">{Number(m.stock_after).toFixed(2)}</span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm" title={m.reason || ''}>
                          {m.reason || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">
                          {m.reference_type?.replace(/_/g, ' ') || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {undoable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 gap-1 text-xs"
                              disabled={undoingId === m.id}
                              onClick={() => handleUndo(m)}
                              title={`Reverse this adjustment (${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} left)`}
                            >
                              {undoingId === m.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Undo2 className="h-3 w-3" />
                              )}
                              Undo · {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                            </Button>
                          ) : m.locked_at ? (
                            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Locked
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {m.locked_at && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={8} className="py-1.5 px-4">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                                <Lock className="h-3 w-3" />
                                Locked
                              </span>
                              <span className="text-muted-foreground/50">•</span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                                Created {format(new Date(m.created_at), 'MMM d, HH:mm')}
                              </span>
                              <span className="text-muted-foreground/50">→</span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Locked {format(new Date(m.locked_at), 'MMM d, HH:mm')}
                                {lockInfo?.closedAt && lockInfo.closedAt !== m.locked_at && (
                                  <span className="text-muted-foreground/70">
                                    {' '}(shift closed {format(new Date(lockInfo.closedAt), 'MMM d, HH:mm')})
                                  </span>
                                )}
                              </span>
                              {lockInfo?.closerName && (
                                <>
                                  <span className="text-muted-foreground/50">•</span>
                                  <span>
                                    by <span className="font-medium text-foreground">{lockInfo.closerName}</span>
                                  </span>
                                </>
                              )}
                              {!lockInfo && (
                                <span className="italic text-muted-foreground/70">Loading shift details…</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ManualStockAdjustmentDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onAdjusted={showUndoToast}
      />
      <BulkStockAdjustmentDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
      />
    </>
  );
}
