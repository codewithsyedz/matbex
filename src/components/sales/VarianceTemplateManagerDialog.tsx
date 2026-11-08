import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2, X, Save, BookmarkPlus, BarChart3, TrendingUp, TrendingDown, Minus, Search, CalendarIcon, FileSpreadsheet, FileText } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useVarianceNoteTemplates,
  type VarianceNoteTemplate,
} from "@/hooks/useVarianceNoteTemplates";
import { DAY_END_REASONS } from "@/components/dayend/DayEndAdjustmentDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVarianceTemplateAnalytics } from "@/hooks/useVarianceTemplateAnalytics";
import { useCurrency } from "@/hooks/useCurrency";
import { VarianceTemplateDrilldownDialog } from "./VarianceTemplateDrilldownDialog";
import { VarianceTemplateTimeseriesChart } from "./VarianceTemplateTimeseriesChart";
import {
  exportAnalyticsCsv,
  exportAnalyticsPdf,
  type AnalyticsExportRow,
} from "@/lib/varianceTemplateAnalyticsExport";
import { useAuth } from "@/contexts/AuthContext";

const BUILTIN_LABELS: Record<string, string> = {
  missing_receipt: "Missing receipt(s)",
  cash_short: "Cash drawer short",
  card_batch_mismatch: "Card refund batch mismatch",
  printer_skipped: "POS printer skipped receipts",
  delivery_sync: "Delivery platform sync delay",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const PLACEHOLDERS = [
  { token: "{abs_variance}", desc: "Absolute variance amount (formatted)" },
  { token: "{variance}", desc: "Signed variance amount" },
  { token: "{direction}", desc: "'over' or 'short'" },
  { token: "{date}", desc: "Business date" },
];

export function VarianceTemplateManagerDialog({ open, onOpenChange }: Props) {
  const { templates, create, update, remove, isLoading } = useVarianceNoteTemplates();
  const [tab, setTab] = useState<"manage" | "analytics">("manage");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState<string>("none");

  const reset = () => {
    setEditingId(null);
    setLabel("");
    setBody("");
    setReason("none");
  };

  const startEdit = (t: VarianceNoteTemplate) => {
    setEditingId(t.id);
    setLabel(t.label);
    setBody(t.body);
    setReason(t.reason ?? "none");
  };

  const insertPlaceholder = (token: string) => {
    setBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${token}`);
  };

  const canSave = label.trim().length >= 2 && body.trim().length >= 5;

  const handleSave = async () => {
    const payload = {
      label: label.trim(),
      body: body.trim(),
      reason: reason === "none" ? null : reason,
    };
    if (editingId) {
      await update.mutateAsync({ id: editingId, patch: payload });
    } else {
      await create.mutateAsync(payload);
    }
    reset();
  };

  const submitting = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-5 w-5 text-primary" />
            Custom variance note templates
          </DialogTitle>
          <DialogDescription>
            Save reusable templates with bracket placeholders like
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">[cashier name]</code>
            and dynamic tokens like
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">{"{abs_variance}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "manage" | "analytics")}>
          <TabsList className="grid grid-cols-2 w-full h-9">
            <TabsTrigger value="manage" className="text-xs gap-1">
              <BookmarkPlus className="h-3.5 w-3.5" /> Manage
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs gap-1">
              <BarChart3 className="h-3.5 w-3.5" /> Analytics
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manage" className="mt-3">
        <ScrollArea className="max-h-[65vh] pr-2">
          <div className="space-y-5">
            {/* Editor */}
            <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {editingId ? "Edit template" : "New template"}
                </h3>
                {editingId && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <X className="h-3 w-3" /> Cancel edit
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Tip pool miscount"
                  maxLength={60}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Linked reason (optional)</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No specific reason</SelectItem>
                    {DAY_END_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Reason-matched templates appear first in the wizard.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Body</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder="e.g. Tip pool short by {abs_variance}. Cashier: [name]. Reviewed by [manager]."
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] text-muted-foreground self-center mr-1">
                    Insert token:
                  </span>
                  {PLACEHOLDERS.map((p) => (
                    <Button
                      key={p.token}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => insertPlaceholder(p.token)}
                      className="h-6 px-2 text-[10px] font-mono"
                      title={p.desc}
                    >
                      {p.token}
                    </Button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Use square-bracket placeholders like
                  <code className="mx-1 rounded bg-background px-1">[name]</code>
                  for fields users should fill in by hand.
                </p>
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={!canSave || submitting}>
                  <Save className="h-3.5 w-3.5" />
                  {editingId ? "Update template" : "Save template"}
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Saved templates{" "}
                <span className="text-xs text-muted-foreground">({templates.length})</span>
              </h3>
              {isLoading && (
                <p className="text-xs text-muted-foreground">Loading...</p>
              )}
              {!isLoading && templates.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No custom templates yet. Save your first one above.
                </div>
              )}
              {templates.map((t) => {
                const reasonDef = DAY_END_REASONS.find((r) => r.value === t.reason);
                return (
                  <div
                    key={t.id}
                    className="rounded-md border p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{t.label}</span>
                        {reasonDef && (
                          <Badge variant="secondary" className="text-[10px]">
                            {reasonDef.label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                        {t.body}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(t)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete template "${t.label}"?`)) {
                            remove.mutate(t.id);
                            if (editingId === t.id) reset();
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
          </TabsContent>
          <TabsContent value="analytics" className="mt-3">
            <ScrollArea className="max-h-[65vh] pr-2">
              <AnalyticsPanel customTemplates={templates} />
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnalyticsPanel({ customTemplates }: { customTemplates: VarianceNoteTemplate[] }) {
  const [from, setFrom] = useState<Date>(() => startOfDay(subDays(new Date(), 89)));
  const [to, setTo] = useState<Date>(() => endOfDay(new Date()));
  const fromISO = useMemo(() => from.toISOString(), [from]);
  const toISO = useMemo(() => to.toISOString(), [to]);
  const { data: analytics, isLoading } = useVarianceTemplateAnalytics({ fromISO, toISO });
  const { format: formatCurrency } = useCurrency();
  const { restaurant } = useAuth();
  const [drilldown, setDrilldown] = useState<{
    key: string;
    label: string;
    min: number;
    max: number;
  } | null>(null);

  const applyPreset = (preset: string) => {
    const now = new Date();
    switch (preset) {
      case "7":
        setFrom(startOfDay(subDays(now, 6))); setTo(endOfDay(now)); break;
      case "30":
        setFrom(startOfDay(subDays(now, 29))); setTo(endOfDay(now)); break;
      case "90":
        setFrom(startOfDay(subDays(now, 89))); setTo(endOfDay(now)); break;
      case "180":
        setFrom(startOfDay(subDays(now, 179))); setTo(endOfDay(now)); break;
      case "365":
        setFrom(startOfDay(subDays(now, 364))); setTo(endOfDay(now)); break;
      case "this_month":
        setFrom(startOfDay(startOfMonth(now))); setTo(endOfDay(now)); break;
      case "last_month": {
        const lm = subMonths(now, 1);
        setFrom(startOfDay(startOfMonth(lm))); setTo(endOfDay(endOfMonth(lm))); break;
      }
      case "ytd":
        setFrom(startOfDay(startOfYear(now))); setTo(endOfDay(now)); break;
    }
  };

  const rangeLabel = `${format(from, "MMM d, yyyy")} → ${format(to, "MMM d, yyyy")}`;

  const resolveLabel = (key: string): { label: string; kind: "builtin" | "custom"; reason?: string | null } => {
    if (key.startsWith("builtin:")) {
      const id = key.slice("builtin:".length);
      return { label: BUILTIN_LABELS[id] ?? id, kind: "builtin" };
    }
    if (key.startsWith("custom:")) {
      const id = key.slice("custom:".length);
      const t = customTemplates.find((x) => x.id === id);
      return { label: t?.label ?? "(deleted custom template)", kind: "custom", reason: t?.reason };
    }
    return { label: key, kind: "custom" };
  };

  const rows = Object.values(analytics ?? {}).sort((a, b) => b.use_count - a.use_count);
  const totalUses = rows.reduce((s, r) => s + r.use_count, 0);
  const maxUses = Math.max(1, ...rows.map((r) => r.use_count));

  const buildExportRows = (): AnalyticsExportRow[] =>
    rows.map((r) => {
      const meta = resolveLabel(r.template_key);
      const reasonDef = meta.reason
        ? DAY_END_REASONS.find((d) => d.value === meta.reason)
        : null;
      return {
        template_label: meta.label,
        template_kind: meta.kind,
        reason_label: reasonDef?.label ?? null,
        use_count: r.use_count,
        short_count: r.short_count,
        over_count: r.over_count,
        median_abs_variance: r.median_abs_variance,
        avg_variance: r.avg_variance,
        min_variance: r.min_variance,
        max_variance: r.max_variance,
        last_used_at: r.last_used_at,
      };
    });

  const handleExportCsv = () => {
    exportAnalyticsCsv(buildExportRows(), {
      rangeLabel,
      restaurantName: restaurant?.name,
      currencyFormatter: formatCurrency,
    });
  };

  const handleExportPdf = () => {
    exportAnalyticsPdf(buildExportRows(), {
      rangeLabel,
      restaurantName: restaurant?.name
        ? `${restaurant.name} · Variance Template Analytics`
        : undefined,
      currencyFormatter: formatCurrency,
    });
  };

  const resolveLabelForChart = (key: string) => {
    const m = resolveLabel(key);
    return { label: m.label, kind: m.kind };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Template usage analytics</h3>
          <p className="text-[11px] text-muted-foreground">
            {totalUses} selection{totalUses === 1 ? "" : "s"} across {rows.length} template
            {rows.length === 1 ? "" : "s"} · {rangeLabel}
          </p>
        </div>
        <Select onValueChange={applyPreset}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Quick presets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="ytd">Year to date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DateField label="From" date={from} onChange={(d) => d && setFrom(startOfDay(d))} max={to} />
        <DateField label="To" date={to} onChange={(d) => d && setTo(endOfDay(d))} min={from} />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px] gap-1"
          disabled={rows.length === 0}
          onClick={handleExportCsv}
        >
          <FileSpreadsheet className="h-3 w-3" />
          Export CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px] gap-1"
          disabled={rows.length === 0}
          onClick={handleExportPdf}
        >
          <FileText className="h-3 w-3" />
          Export PDF
        </Button>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
          No template selections recorded yet. Use a template in the variance wizard to start
          collecting analytics.
        </div>
      )}

      {rows.length > 0 && (
        <VarianceTemplateTimeseriesChart
          fromISO={fromISO}
          toISO={toISO}
          resolveLabel={resolveLabelForChart}
          templateKeys={rows.map((r) => r.template_key)}
        />
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => {
            const meta = resolveLabel(r.template_key);
            const reasonDef = meta.reason
              ? DAY_END_REASONS.find((d) => d.value === meta.reason)
              : null;
            const sharePct = (r.use_count / maxUses) * 100;
            const direction =
              r.short_count > r.over_count
                ? { icon: TrendingDown, label: "Mostly shortages", className: "text-rose-600" }
                : r.over_count > r.short_count
                  ? { icon: TrendingUp, label: "Mostly overages", className: "text-emerald-600" }
                  : { icon: Minus, label: "Even split", className: "text-muted-foreground" };
            const DirIcon = direction.icon;
            return (
              <div key={r.template_key} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{meta.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {meta.kind === "builtin" ? "Built-in" : "Custom"}
                      </Badge>
                      {reasonDef && (
                        <Badge variant="secondary" className="text-[10px]">
                          {reasonDef.label}
                        </Badge>
                      )}
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 text-[11px] ${direction.className}`}>
                      <DirIcon className="h-3 w-3" />
                      {direction.label}
                      <span className="text-muted-foreground ml-1">
                        ({r.short_count} short / {r.over_count} over)
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-semibold tabular-nums">{r.use_count}</div>
                    <div className="text-[10px] text-muted-foreground">uses</div>
                  </div>
                </div>

                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${sharePct}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <Stat label="Median |variance|" value={formatCurrency(r.median_abs_variance)} />
                  <Stat label="Avg variance" value={formatCurrency(r.avg_variance)} />
                  <Stat
                    label="Range"
                    value={`${formatCurrency(r.min_variance)} → ${formatCurrency(r.max_variance)}`}
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1"
                    onClick={() =>
                      setDrilldown({
                        key: r.template_key,
                        label: meta.label,
                        min: Math.abs(Math.min(r.min_variance, 0)),
                        max: Math.max(Math.abs(r.min_variance), Math.abs(r.max_variance)),
                      })
                    }
                  >
                    <Search className="h-3 w-3" />
                    View shifts & notes
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VarianceTemplateDrilldownDialog
        open={!!drilldown}
        onOpenChange={(o) => !o && setDrilldown(null)}
        templateKey={drilldown?.key ?? null}
        templateLabel={drilldown?.label ?? ""}
        fromISO={fromISO}
        toISO={toISO}
        rangeLabel={rangeLabel}
        initialMin={drilldown?.min}
        initialMax={drilldown?.max}
      />
    </div>
  );
}

function DateField({
  label,
  date,
  onChange,
  min,
  max,
}: {
  label: string;
  date: Date;
  onChange: (d: Date | undefined) => void;
  min?: Date;
  max?: Date;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 w-full justify-start text-xs font-normal", !date && "text-muted-foreground")}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
            {date ? format(date, "MMM d, yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onChange}
            disabled={(d) => (min ? d < startOfDay(min) : false) || (max ? d > endOfDay(max) : false)}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-[11px] font-medium tabular-nums truncate">{value}</div>
    </div>
  );
}

export function ManageTemplatesButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 px-2 text-[11px] gap-1"
    >
      <Plus className="h-3 w-3" />
      Manage
    </Button>
  );
}