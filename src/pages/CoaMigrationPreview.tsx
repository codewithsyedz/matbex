import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Download, ShieldCheck, Wand2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useCoaMigration } from "@/hooks/useCoaMigration";
import { ACTION_LABELS, type MigrationAction, type MigrationRow } from "@/lib/coaMigrationPlan";

const ACTION_VARIANT: Record<MigrationAction, "default" | "secondary" | "outline" | "destructive"> = {
  match: "outline",
  rename: "secondary",
  recode: "default",
  retype: "destructive",
  create: "default",
  unmapped: "outline",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "changes", label: "Pending changes" },
  { value: "conflicts", label: "Conflicts" },
  { value: "match", label: "Already aligned" },
  { value: "unmapped", label: "Custom accounts" },
  { value: "all", label: "All" },
];

export default function CoaMigrationPreview() {
  const { plan, isLoading, applyMigration } = useCoaMigration();

  const [filter, setFilter] = useState("changes");
  const [search, setSearch] = useState("");
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isSelected = (row: MigrationRow) => row.defaultSelected && !deselected.has(row.key);
  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const selectedRows = useMemo(() => plan.rows.filter(isSelected), [plan.rows, deselected]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plan.rows.filter((row) => {
      if (filter === "changes" && (row.action === "match" || row.action === "unmapped" || row.conflict)) return false;
      if (filter === "conflicts" && !row.conflict) return false;
      if (filter === "match" && row.action !== "match") return false;
      if (filter === "unmapped" && row.action !== "unmapped") return false;
      if (!q) return true;
      const hay = [
        row.existing?.account_code,
        row.existing?.account_name,
        row.target?.code,
        row.target?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [plan.rows, filter, search]);

  const exportCsv = () => {
    const head = ["Action", "Current code", "Current name", "Current type", "New code", "New name", "New type", "Conflict"];
    const lines = plan.rows.map((r) => [
      ACTION_LABELS[r.action],
      r.existing?.account_code ?? "",
      r.existing?.account_name ?? "",
      r.existing?.account_type ?? "",
      r.target?.code ?? "",
      r.target?.name ?? "",
      r.target?.type ?? "",
      r.conflict ?? "",
    ]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `coa-migration-preview-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canApply = selectedRows.length > 0 && confirmText.trim().toUpperCase() === "MIGRATE";

  const handleApply = async () => {
    await applyMigration.mutateAsync(selectedRows);
    setConfirmOpen(false);
    setConfirmText("");
    setDeselected(new Set());
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Chart of Accounts Migration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Preview how your existing accounts map onto the standard structure. Nothing is changed until you confirm.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export preview
          </Button>
          <Button size="sm" disabled={selectedRows.length === 0} onClick={() => setConfirmOpen(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            Review &amp; apply ({selectedRows.length})
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(ACTION_LABELS) as MigrationAction[]).map((action) => (
          <Card key={action}>
            <CardContent className="pt-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{ACTION_LABELS[action]}</p>
              <p className="mt-1 text-2xl font-light">{plan.counts[action]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {plan.conflicts > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{plan.conflicts} row(s) need manual attention</AlertTitle>
          <AlertDescription>
            Conflicted rows are excluded from the migration. Resolve the duplicate code or reclassify the posted
            account in the Chart of Accounts screen, then re-run this preview.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">Mapping preview</CardTitle>
              <CardDescription>{visibleRows.length} row(s) shown</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code or name…"
                className="h-9 w-56"
              />
              <Tabs value={filter} onValueChange={setFilter}>
                <TabsList>
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Action</TableHead>
                  <TableHead>Current account</TableHead>
                  <TableHead className="w-8" />
                  <TableHead>Standard account</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={row.key} className={row.conflict ? "bg-destructive/5" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected(row)}
                        disabled={!row.defaultSelected}
                        onCheckedChange={() => toggle(row.key)}
                        aria-label="Include in migration"
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[row.action]}>{ACTION_LABELS[row.action]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.existing ? (
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">{row.existing.account_code}</span>{" "}
                          {row.existing.account_name}
                          <span className="ml-2 text-xs text-muted-foreground">({row.existing.account_type})</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">— not present —</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.target && row.existing && row.changes.length > 0 && (
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.target ? (
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">{row.target.code}</span>{" "}
                          {row.target.name}
                          <span className="ml-2 text-xs text-muted-foreground">({row.target.type})</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">kept as custom</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[24rem] text-xs text-muted-foreground">
                      {row.conflict ? <span className="text-destructive">{row.conflict}</span> : row.note}
                    </TableCell>
                  </TableRow>
                ))}
                {visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Nothing to show for this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm chart of accounts migration</DialogTitle>
            <DialogDescription>
              These changes rename, re-code and create ledger accounts. Existing journal entries stay attached to the
              same accounts, but reports will show the new codes and names.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              {(["rename", "recode", "retype", "create"] as MigrationAction[]).map((a) => {
                const n = selectedRows.filter((r) => r.action === a).length;
                return (
                  <div key={a} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{ACTION_LABELS[a]}</p>
                    <p className="text-xl font-light">{n}</p>
                  </div>
                );
              })}
            </div>

            <ScrollArea className="max-h-56 rounded-md border p-3">
              <ul className="space-y-1 text-xs">
                {selectedRows.map((r) => (
                  <li key={r.key} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                    <span>
                      {ACTION_LABELS[r.action]}:{" "}
                      {r.existing ? `${r.existing.account_code} ${r.existing.account_name}` : "—"}
                      {r.target ? ` → ${r.target.code} ${r.target.name}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>

            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Type this exactly to unlock the apply button: <strong>MIGRATE</strong>
              </AlertDescription>
            </Alert>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type MIGRATE to confirm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canApply || applyMigration.isPending} onClick={handleApply}>
              {applyMigration.isPending ? "Applying…" : `Apply ${selectedRows.length} change(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
