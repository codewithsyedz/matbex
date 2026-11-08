import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, Search } from "lucide-react";
import {
  scanDialogDescriptions,
  type DialogDescriptionRow,
} from "@/lib/a11y/scanDialogDescriptions";
import { runtimeDialogAudit } from "@/lib/a11y/runtimeDialogAudit";

type StatusFilter = "all" | "custom" | "fallback";
type KindFilter = "all" | DialogDescriptionRow["kind"];

const KIND_LABEL: Record<DialogDescriptionRow["kind"], string> = {
  dialog: "Dialog",
  "alert-dialog": "Alert Dialog",
  sheet: "Sheet",
  drawer: "Drawer",
};

export default function AdminA11yDialogs() {
  // The static scan needs the raw source of every file, which is only bundled
  // in development. In production the runtime audit below is still available.
  const [sources, setSources] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (import.meta.env.DEV) {
      void import("@/lib/a11y/sourceSnapshot").then((m) => {
        if (!cancelled) setSources(m.default);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => (sources ? scanDialogDescriptions(sources) : []),
    [sources],
  );
  const runtime = useSyncExternalStore(
    (cb) => runtimeDialogAudit.subscribe(cb),
    () => runtimeDialogAudit.getState(),
    () => runtimeDialogAudit.getState(),
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "custom" && !r.hasCustomDescription) return false;
      if (statusFilter === "fallback" && r.hasCustomDescription) return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        r.file.toLowerCase().includes(q) ||
        (r.descriptionPreview ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, kindFilter]);

  const totals = useMemo(() => {
    const byKind: Record<string, { total: number; custom: number }> = {};
    let total = 0;
    let custom = 0;
    for (const r of rows) {
      total += 1;
      if (r.hasCustomDescription) custom += 1;
      const k = byKind[r.kind] ?? { total: 0, custom: 0 };
      k.total += 1;
      if (r.hasCustomDescription) k.custom += 1;
      byKind[r.kind] = k;
    }
    return { total, custom, fallback: total - custom, byKind };
  }, [rows]);

  const coverage = totals.total === 0 ? 100 : Math.round((totals.custom / totals.total) * 100);

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Dialog Accessibility Audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Static scan of every <code>DialogContent</code>, <code>AlertDialogContent</code>,{" "}
            <code>SheetContent</code>, and <code>DrawerContent</code> in the codebase, showing
            whether each one passes a custom <code>description</code> prop or falls back to the
            generic screen-reader text.
          </p>
        </header>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <Label htmlFor="runtime-audit-toggle" className="text-base font-medium">
                Runtime audit mode
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, a floating panel appears on every page and reports each
                dialog, sheet, or drawer that opens - flagging any without a proper
                description. The setting persists across reloads (or use{" "}
                <code>?a11yAudit=1</code> in the URL).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={
                  runtime.enabled
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "text-muted-foreground"
                }
              >
                {runtime.enabled
                  ? `Live · ${runtime.findings.length} observed`
                  : "Off"}
              </Badge>
              <Switch
                id="runtime-audit-toggle"
                checked={runtime.enabled}
                onCheckedChange={(checked) =>
                  checked ? runtimeDialogAudit.enable() : runtimeDialogAudit.disable()
                }
                aria-label="Toggle runtime accessibility audit mode"
              />
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">
                Total dialog instances
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{totals.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">
                Custom descriptions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-primary">{totals.custom}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">
                Using fallback
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-destructive">
                {totals.fallback}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">
                Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{coverage}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                {Object.entries(totals.byKind)
                  .map(
                    ([k, v]) =>
                      `${KIND_LABEL[k as DialogDescriptionRow["kind"]]}: ${v.custom}/${v.total}`,
                  )
                  .join(" · ")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by file path or description text"
                  className="pl-9"
                  aria-label="Search dialog audit results"
                />
              </div>
              <Select
                value={kindFilter}
                onValueChange={(v) => setKindFilter(v as KindFilter)}
              >
                <SelectTrigger className="md:w-48" aria-label="Filter by component type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All component types</SelectItem>
                  <SelectItem value="dialog">Dialog</SelectItem>
                  <SelectItem value="alert-dialog">Alert Dialog</SelectItem>
                  <SelectItem value="sheet">Sheet</SelectItem>
                  <SelectItem value="drawer">Drawer</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="md:w-48" aria-label="Filter by description status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="custom">Custom description</SelectItem>
                  <SelectItem value="fallback">Using fallback</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Results table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Showing {filtered.length} of {totals.total} dialog instances
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[65vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Type</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="w-[110px]">Line</TableHead>
                    <TableHead className="w-[160px]">Status</TableHead>
                    <TableHead>Description preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No dialog instances match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r, idx) => (
                      <TableRow key={`${r.file}:${r.line}:${idx}`}>
                        <TableCell>
                          <Badge variant="outline">{KIND_LABEL[r.kind]}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.file}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.line}
                        </TableCell>
                        <TableCell>
                          {r.hasCustomDescription ? (
                            <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              Custom
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-destructive/10 text-destructive border-destructive/20 gap-1"
                            >
                              <AlertCircle className="h-3 w-3" aria-hidden="true" />
                              Fallback
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.descriptionPreview ? (
                            <span className="text-foreground">{r.descriptionPreview}</span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              Generic screen-reader fallback
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}