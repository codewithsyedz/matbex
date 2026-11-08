import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Plus } from "lucide-react";
import {
  COMPLIANCE_SOURCE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  type ComplianceViolation,
  type ViolationFilters,
} from "@/hooks/useComplianceViolations";
import type { ComplianceCategory } from "@/hooks/useComplianceConfig";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  violations: ComplianceViolation[];
  isLoading: boolean;
  filters: ViolationFilters;
  onFilters: (p: Partial<ViolationFilters>) => void;
  categories: ComplianceCategory[];
  staff: { id: string; name: string }[];
  onNew: () => void;
  onSelect: (v: ComplianceViolation) => void;
  onExport: () => void;
}

export function ViolationsTab({
  violations,
  isLoading,
  filters,
  onFilters,
  categories,
  staff,
  onNew,
  onSelect,
  onExport,
}: Props) {
  const { format: money } = useCurrency();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={filters.from ?? ""} onChange={(e) => onFilters({ from: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={filters.to ?? ""} onChange={(e) => onFilters({ to: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={filters.categoryId ?? "all"} onValueChange={(v) => onFilters({ categoryId: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={filters.status ?? "open"}
              onValueChange={(v) => onFilters({ status: v as ViolationFilters["status"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="all">All</SelectItem>
                {Object.entries(COMPLIANCE_STATUS_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Source</Label>
            <Select
              value={filters.source ?? "all"}
              onValueChange={(v) => onFilters({ source: v as ViolationFilters["source"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(COMPLIANCE_SOURCE_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Employee</Label>
            <Select value={filters.staffId ?? "all"} onValueChange={(v) => onFilters({ staffId: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{violations.length} violation(s)</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button size="sm" onClick={onNew}>
            <Plus className="mr-2 h-4 w-4" /> Record violation
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : violations.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No violations match these filters.</TableCell></TableRow>
              ) : (
                violations.map((v) => (
                  <TableRow key={v.id} className="cursor-pointer" onClick={() => onSelect(v)}>
                    <TableCell className="font-mono text-xs">{v.violation_number ?? "—"}</TableCell>
                    <TableCell>{format(new Date(v.violation_date), "dd MMM yyyy")}</TableCell>
                    <TableCell>{v.branch?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{v.violation_type?.name_en ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{v.category?.name_en ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-xs">{COMPLIANCE_SOURCE_LABELS[v.source]}</TableCell>
                    <TableCell>{v.responsible_staff?.name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={v.status === "closed" ? "secondary" : "outline"}>
                          {COMPLIANCE_STATUS_LABELS[v.status]}
                        </Badge>
                        {v.is_overdue && v.status !== "closed" ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : null}
                        {v.is_municipality_fine ? <Badge>Municipality</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(v.fine_amount) ? money(Number(v.fine_amount)) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}