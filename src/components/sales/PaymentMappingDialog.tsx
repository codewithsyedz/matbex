import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Upload, Download, FileText, AlertCircle, Plus, Trash2, Wand2, Info, Sparkles, History, Settings2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  fetchPaymentMap,
  savePaymentMap,
  bucketForPaymentMethod,
  fetchPaymentRules,
  savePaymentRules,
  ruleMatches,
  suggestBucket,
  fetchPaymentMappingAudit,
  type PaymentMappingAuditEntry,
  type BucketSuggestion,
  type SuggestionSource,
  type PaymentRule,
  type RuleMatchType,
  type PaymentBucket,
} from "@/lib/posPaymentMapping";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  /** yyyy-MM-dd - when provided, shows a preview of how mapping changes affect this date's totals */
  date?: string;
  onSaved?: () => void;
}

const BUCKETS: PaymentBucket[] = ["cash", "card", "delivery", "other"];
const MATCH_TYPES: RuleMatchType[] = ["contains", "prefix", "suffix", "exact", "regex"];

const SOURCE_META: Record<
  SuggestionSource,
  { label: string; icon: typeof Wand2; className: string }
> = {
  override: { label: "saved", icon: History, className: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300" },
  rule: { label: "rule", icon: Wand2, className: "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300" },
  default: { label: "default", icon: Settings2, className: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300" },
  similarity: { label: "similar", icon: Sparkles, className: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300" },
  fallback: { label: "fallback", icon: Info, className: "border-muted-foreground/30 text-muted-foreground" },
};

function SuggestionBadge({ suggestion }: { suggestion: BucketSuggestion }) {
  const meta = SOURCE_META[suggestion.source];
  const Icon = meta.icon;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`gap-1 text-[10px] cursor-help ${meta.className}`}>
            <Icon className="h-3 w-3" /> {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <div className="font-medium capitalize">→ {suggestion.bucket}</div>
          <div className="text-muted-foreground">{suggestion.reason}</div>
          {suggestion.detail && (
            <div className="mt-0.5 text-muted-foreground/80">{suggestion.detail}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function parseImport(
  text: string,
): { ok: Record<string, PaymentBucket>; errors: string[] } {
  const out: Record<string, PaymentBucket> = {};
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { ok: out, errors: ["File is empty"] };

  // Try JSON: object {method:bucket} or array [{payment_method, bucket}]
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const entries: [string, unknown][] = Array.isArray(parsed)
        ? parsed.map((r: Record<string, unknown>, i: number) => [
            String(r.payment_method ?? r.method ?? ""),
            r.bucket ?? r.category,
          ])
        : Object.entries(parsed as Record<string, unknown>);
      entries.forEach(([k, v], i) => {
        const key = String(k || "").trim().toLowerCase();
        const bucket = String(v || "").trim().toLowerCase();
        if (!key) return errors.push(`Row ${i + 1}: missing payment method`);
        if (!BUCKETS.includes(bucket as PaymentBucket))
          return errors.push(`Row ${i + 1} (${key}): invalid bucket "${bucket}"`);
        out[key] = bucket as PaymentBucket;
      });
      return { ok: out, errors };
    } catch (e) {
      return { ok: out, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }

  // CSV: payment_method,bucket  (header optional)
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  let start = 0;
  const first = lines[0]?.toLowerCase() ?? "";
  if (first.includes("payment_method") || first.includes("method")) start = 1;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const [k, v] = [cols[0], cols[1]];
    const key = (k || "").toLowerCase();
    const bucket = (v || "").toLowerCase();
    if (!key) {
      errors.push(`Line ${i + 1}: missing payment method`);
      continue;
    }
    if (!BUCKETS.includes(bucket as PaymentBucket)) {
      errors.push(`Line ${i + 1} (${key}): invalid bucket "${bucket}"`);
      continue;
    }
    out[key] = bucket as PaymentBucket;
  }
  return { ok: out, errors };
}

const TEMPLATE_CSV =
  "payment_method,bucket\ncash,cash\nmada,card\nvisa,card\nhungerstation,delivery\njahez,delivery\nstc_pay,other\n";

export function PaymentMappingDialog({ open, onOpenChange, restaurantId, date, onSaved }: Props) {
  const { tenant } = useAuth();
  const queryClient = useQueryClient();
  const { format: formatCurrency } = useCurrency();
  const [activeTab, setActiveTab] = useState<"methods" | "rules" | "audit">("methods");
  const [map, setMap] = useState<Record<string, PaymentBucket>>({});
  const [rules, setRules] = useState<PaymentRule[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"all" | PaymentBucket>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | SuggestionSource>("all");

  const { data: storedMap } = useQuery({
    queryKey: ["pos-payment-map", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: () => fetchPaymentMap(restaurantId),
  });

  const { data: storedRules } = useQuery({
    queryKey: ["pos-payment-rules", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: () => fetchPaymentRules(restaurantId),
  });

  const { data: auditEntries = [], isLoading: auditLoading } = useQuery<PaymentMappingAuditEntry[]>({
    queryKey: ["pos-payment-audit", restaurantId],
    enabled: open && !!restaurantId && activeTab === "audit",
    queryFn: () => fetchPaymentMappingAudit(restaurantId, 100),
  });

  const auditUserIds = useMemo(
    () => Array.from(new Set(auditEntries.map((e) => e.changed_by).filter((v): v is string => !!v))),
    [auditEntries],
  );
  const { data: auditUsers = {} } = useQuery<Record<string, string>>({
    queryKey: ["pos-payment-audit-users", auditUserIds],
    enabled: open && auditUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id,full_name")
        .in("id", auditUserIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of data || []) {
        const row = r as { id: string; full_name: string | null };
        map[row.id] = row.full_name || row.id.slice(0, 8);
      }
      return map;
    },
  });

  useEffect(() => {
    if (open && storedMap) setMap(storedMap);
  }, [open, storedMap]);

  useEffect(() => {
    if (open && storedRules) setRules(storedRules);
  }, [open, storedRules]);

  // Pull distinct payment_method values seen for this restaurant
  const { data: methods = [] } = useQuery<{ method: string; count: number }[]>({
    queryKey: ["distinct-payment-methods", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("sales_transactions")
        .select("payment_method")
        .eq("restaurant_id", restaurantId)
        .limit(1000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of data || []) {
        const v = String((r as { payment_method: string | null }).payment_method || "").toLowerCase();
        if (v) counts.set(v, (counts.get(v) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([method, count]) => ({ method, count }))
        .sort((a, b) => b.count - a.count);
    },
  });

  // Pull this date's transactions for the live preview
  const { data: dayTx = [] } = useQuery({
    queryKey: ["payment-mapping-preview-tx", restaurantId, date],
    enabled: open && !!restaurantId && !!date,
    queryFn: async () => {
      const { data, error } = await db
        .from("sales_transactions")
        .select("total,payment_method")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", `${date}T00:00:00`)
        .lt("created_at", `${date}T23:59:59.999`);
      if (error) throw error;
      return (data || []) as { total: number | string | null; payment_method: string | null }[];
    },
  });

  const empty = { cash: 0, card: 0, delivery: 0, other: 0 } as Record<PaymentBucket, number>;

  const currentTotals = useMemo(() => {
    const acc = { ...empty };
    for (const r of dayTx) {
      const amt = Number(r.total) || 0;
      acc[bucketForPaymentMethod(r.payment_method, storedMap || {}, storedRules || [])] += amt;
    }
    return acc;
  }, [dayTx, storedMap, storedRules]);

  const proposedTotals = useMemo(() => {
    const acc = { ...empty };
    for (const r of dayTx) {
      const amt = Number(r.total) || 0;
      acc[bucketForPaymentMethod(r.payment_method, map, rules)] += amt;
    }
    return acc;
  }, [dayTx, map, rules]);

  const hasChanges = useMemo(() => {
    const stored = storedMap || {};
    const keys = new Set([...Object.keys(stored), ...Object.keys(map)]);
    for (const k of keys) {
      if ((stored[k] ?? bucketForPaymentMethod(k, {})) !== (map[k] ?? bucketForPaymentMethod(k, {}))) return true;
    }
    if (JSON.stringify(stored) !== JSON.stringify(map)) {
      // already covered above, kept for clarity
    }
    if (JSON.stringify(storedRules || []) !== JSON.stringify(rules)) return true;
    return false;
  }, [map, storedMap, rules, storedRules]);

  const rows = useMemo(
    () =>
      methods.map(({ method, count }) => {
        const suggestion = suggestBucket(method, map, rules);
        return {
          method,
          count,
          current: map[method] ?? suggestion.bucket,
          explicit: Object.prototype.hasOwnProperty.call(map, method),
          suggestion,
        };
      }),
    [methods, map, rules],
  );

  const unmappedRows = useMemo(() => rows.filter((r) => !r.explicit), [rows]);
  const mappedRows = useMemo(() => rows.filter((r) => r.explicit), [rows]);

  const matchesFilters = (r: (typeof rows)[number]) => {
    if (search && !r.method.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (bucketFilter !== "all" && r.current !== bucketFilter) return false;
    if (sourceFilter !== "all" && (r.explicit ? "override" : r.suggestion.source) !== sourceFilter) return false;
    return true;
  };

  const filteredUnmapped = useMemo(() => unmappedRows.filter(matchesFilters), [unmappedRows, search, bucketFilter, sourceFilter]);
  const filteredMapped = useMemo(() => mappedRows.filter(matchesFilters), [mappedRows, search, bucketFilter, sourceFilter]);
  const hasActiveFilters = search.trim() !== "" || bucketFilter !== "all" || sourceFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setBucketFilter("all");
    setSourceFilter("all");
  };

  // Auto-enable review-only mode when the dialog opens and there are unmapped methods
  useEffect(() => {
    if (open) setReviewOnly(unmappedRows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, methods.length]);

  const renderRow = (r: (typeof rows)[number]) => (
    <div key={r.method} className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="secondary" className="font-mono text-xs">
          {r.method}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {r.count} tx
        </span>
        {!r.explicit && <SuggestionBadge suggestion={r.suggestion} />}
      </div>
      <Select
        value={r.current}
        onValueChange={(v) => handleChange(r.method, v as PaymentBucket)}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BUCKETS.map((b) => (
            <SelectItem key={b} value={b} className="capitalize">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const handleChange = (method: string, bucket: PaymentBucket) => {
    setMap((prev) => ({ ...prev, [method]: bucket }));
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const { ok, errors } = parseImport(text);
      const okCount = Object.keys(ok).length;
      if (okCount === 0) {
        toast.error(errors[0] || "No valid mappings found");
        return;
      }
      setMap((prev) => ({ ...prev, ...ok }));
      if (errors.length > 0) {
        toast.warning(`Imported ${okCount} mapping(s) - ${errors.length} skipped`, {
          description: errors.slice(0, 3).join(" • "),
        });
      } else {
        toast.success(`Imported ${okCount} mapping(s). Review and Save to apply.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to read file");
    }
  };

  const handleExport = () => {
    const lines = ["payment_method,bucket"];
    for (const [k, v] of Object.entries(map)) lines.push(`${k},${v}`);
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-mapping-${restaurantId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payment-mapping-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!tenant?.id) {
      toast.error("Missing tenant context");
      return;
    }
    try {
      setSaving(true);
      // Reject empty rule patterns
      const cleanRules = rules
        .filter((r) => r.pattern.trim())
        .map((r, i) => ({ ...r, priority: r.priority ?? i * 10 }));
      await Promise.all([
        savePaymentMap(restaurantId, tenant.id, map),
        savePaymentRules(restaurantId, tenant.id, cleanRules),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos-payment-map", restaurantId] }),
        queryClient.invalidateQueries({ queryKey: ["pos-payment-rules", restaurantId] }),
      ]);
      toast.success("Payment mapping saved");
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ["pos-payment-audit", restaurantId] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  /** Accept all currently-suggested buckets for unmapped rows AND persist in one click. */
  const handleApplyAndSave = async () => {
    if (!tenant?.id) {
      toast.error("Missing tenant context");
      return;
    }
    const accepted: Record<string, PaymentBucket> = {};
    for (const r of unmappedRows) accepted[r.method] = r.current;
    const nextMap = { ...map, ...accepted };
    setMap(nextMap);
    try {
      setSaving(true);
      const cleanRules = rules
        .filter((r) => r.pattern.trim())
        .map((r, i) => ({ ...r, priority: r.priority ?? i * 10 }));
      await Promise.all([
        savePaymentMap(restaurantId, tenant.id, nextMap),
        savePaymentRules(restaurantId, tenant.id, cleanRules),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos-payment-map", restaurantId] }),
        queryClient.invalidateQueries({ queryKey: ["pos-payment-rules", restaurantId] }),
      ]);
      toast.success(
        Object.keys(accepted).length > 0
          ? `Applied ${Object.keys(accepted).length} mapping(s) and saved`
          : "Mapping saved",
      );
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ["pos-payment-audit", restaurantId] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        pattern: "",
        match_type: "contains",
        bucket: "other",
        priority: (prev[prev.length - 1]?.priority ?? 0) + 10,
      },
    ]);
  };

  const updateRule = (index: number, patch: Partial<PaymentRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>POS payment mapping</DialogTitle>
          <DialogDescription>
            Categorize each POS payment method into Cash, Card, Delivery, or Other so the
            recorder pre-fills the right column.
          </DialogDescription>
        </DialogHeader>

        {date && dayTx.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Preview for {date}</span>
              {hasChanges ? (
                <Badge variant="secondary" className="text-[10px]">Unsaved changes</Badge>
              ) : (
                <span className="text-[10px]">No changes</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(["cash", "card", "delivery", "other"] as PaymentBucket[]).map((b) => {
                const before = currentTotals[b];
                const after = proposedTotals[b];
                const delta = after - before;
                const changed = Math.abs(delta) > 0.001;
                return (
                  <div key={b} className="rounded-md border bg-background p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{b}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                        {formatCurrency(before)}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className={changed ? "font-semibold text-foreground" : "text-foreground"}>
                        {formatCurrency(after)}
                      </span>
                    </div>
                    {changed && (
                      <div
                        className={
                          "mt-0.5 text-[10px] " +
                          (delta > 0 ? "text-emerald-600" : "text-red-600")
                        }
                      >
                        {delta > 0 ? "+" : ""}
                        {formatCurrency(delta)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
          <div className="flex items-center justify-between gap-2">
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="methods">Methods ({rows.length})</TabsTrigger>
              <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>
            {unmappedRows.length > 0 && (
              <div className="flex items-center gap-2">
                <Switch
                  id="review-only"
                  checked={reviewOnly}
                  onCheckedChange={setReviewOnly}
                />
                <Label htmlFor="review-only" className="cursor-pointer text-xs">
                  Review only ({unmappedRows.length})
                </Label>
              </div>
            )}
          </div>

          <TabsContent value="methods">
        <ScrollArea className="max-h-[50vh] -mx-2 px-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" /> Import CSV/JSON
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadTemplate}>
              <FileText className="mr-1 h-3.5 w-3.5" /> Template
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={Object.keys(map).length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Export
            </Button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              CSV: <code>payment_method,bucket</code>
            </span>
          </div>

          {rows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search payment_method…"
                  className="h-8 pl-7 pr-7 text-xs"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Select value={bucketFilter} onValueChange={(v) => setBucketFilter(v as typeof bucketFilter)}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue placeholder="Bucket" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All buckets</SelectItem>
                  {BUCKETS.map((b) => (
                    <SelectItem key={b} value={b} className="capitalize">{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="override">Saved</SelectItem>
                  <SelectItem value="rule">Rule match</SelectItem>
                  <SelectItem value="default">Built-in default</SelectItem>
                  <SelectItem value="similarity">Similar</SelectItem>
                  <SelectItem value="fallback">Fallback</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No POS payment methods detected yet.
            </div>
          ) : hasActiveFilters && filteredUnmapped.length === 0 && filteredMapped.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No payment methods match your filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredUnmapped.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                      <AlertCircle className="h-4 w-4" />
                      Needs review ({filteredUnmapped.length}
                      {hasActiveFilters && unmappedRows.length !== filteredUnmapped.length
                        ? ` of ${unmappedRows.length}`
                        : ""}
                      )
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setMap((prev) => {
                            const next = { ...prev };
                            for (const r of filteredUnmapped) next[r.method] = r.current;
                            return next;
                          });
                          toast.success(`Accepted ${filteredUnmapped.length} suggested mapping(s)`);
                        }}
                      >
                        Accept all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleApplyAndSave}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Apply & Save"}
                      </Button>
                    </div>
                  </div>
                  <p className="mb-3 text-xs text-amber-800/80 dark:text-amber-200/70">
                    These POS payment methods aren't explicitly mapped yet. Suggested
                    buckets are pre-filled from defaults - confirm or change each, then Save.
                  </p>
                  <div className="space-y-2">{filteredUnmapped.map(renderRow)}</div>
                </div>
              )}

              {!reviewOnly && filteredMapped.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    Mapped ({filteredMapped.length}
                    {hasActiveFilters && mappedRows.length !== filteredMapped.length
                      ? ` of ${mappedRows.length}`
                      : ""}
                    )
                  </div>
                  <div className="space-y-2">{filteredMapped.map(renderRow)}</div>
                </div>
              )}
              {reviewOnly && mappedRows.length > 0 && filteredUnmapped.length === 0 && !hasActiveFilters && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nothing to review. All POS methods are mapped.
                </div>
              )}
            </div>
          )}
        </ScrollArea>
          </TabsContent>

          <TabsContent value="rules">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Rules auto-assign a bucket to any unmapped POS method whose value
                  matches. Lower priority runs first; explicit method mappings always win.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={addRule}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
                </Button>
              </div>

              <ScrollArea className="max-h-[50vh] -mx-2 px-2">
                {rules.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No rules yet. Add one to auto-categorize new payment methods.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rules.map((r, i) => {
                      const sample = methods.find((m) => ruleMatches(m.method, r));
                      return (
                        <div
                          key={i}
                          className="grid grid-cols-12 items-center gap-2 rounded-md border bg-background p-2"
                        >
                          <Input
                            type="number"
                            value={r.priority}
                            onChange={(e) =>
                              updateRule(i, { priority: Number(e.target.value) || 0 })
                            }
                            className="col-span-2 h-8"
                            title="Priority (lower = runs first)"
                          />
                          <Select
                            value={r.match_type}
                            onValueChange={(v) =>
                              updateRule(i, { match_type: v as RuleMatchType })
                            }
                          >
                            <SelectTrigger className="col-span-3 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MATCH_TYPES.map((t) => (
                                <SelectItem key={t} value={t} className="capitalize">
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={r.pattern}
                            placeholder="e.g. mada, _pay, hunger"
                            onChange={(e) => updateRule(i, { pattern: e.target.value })}
                            className="col-span-4 h-8 font-mono text-xs"
                          />
                          <Select
                            value={r.bucket}
                            onValueChange={(v) => updateRule(i, { bucket: v as PaymentBucket })}
                          >
                            <SelectTrigger className="col-span-2 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {BUCKETS.map((b) => (
                                <SelectItem key={b} value={b} className="capitalize">
                                  {b}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="col-span-1 h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRule(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {sample && (
                            <div className="col-span-12 -mt-1 pl-1 text-[10px] text-muted-foreground">
                              Matches <span className="font-mono">{sample.method}</span>
                              {methods.filter((m) => ruleMatches(m.method, r)).length > 1 &&
                                ` +${
                                  methods.filter((m) => ruleMatches(m.method, r)).length - 1
                                } more`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="audit">
            <ScrollArea className="max-h-[50vh] -mx-2 px-2">
              {auditLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Loading audit log…</div>
              ) : auditEntries.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No changes recorded yet. Save a mapping to start the audit trail.
                </div>
              ) : (
                <div className="space-y-2">
                  {auditEntries.map((e) => {
                    const who = e.changed_by ? (auditUsers[e.changed_by] ?? "Unknown user") : "System";
                    const when = new Date(e.changed_at).toLocaleString();
                    return (
                      <div
                        key={e.id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background p-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="outline"
                            className={
                              "text-[10px] capitalize " +
                              (e.action === "create"
                                ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                                : e.action === "delete"
                                ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
                                : "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300")
                            }
                          >
                            {e.action}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {e.payment_method}
                          </Badge>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <span className="capitalize">{e.from_bucket ?? "-"}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="capitalize text-foreground">{e.to_bucket ?? "-"}</span>
                          </div>
                        </div>
                        <div className="text-right text-[10px] text-muted-foreground">
                          <div>{who}</div>
                          <div>{when}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}