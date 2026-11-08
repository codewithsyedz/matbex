import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useCurrency } from "@/hooks/useCurrency";
import type { ProjectTransaction, useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

const STATUS_LABEL: Record<string, string> = {
  needs_review: "Needs review",
  classified: "Classified",
  posted: "Posted",
  rejected: "Rejected",
  voided: "Voided",
};

export function ProjectCategoryDrilldownDialog({
  api,
  category,
  onOpenChange,
}: {
  api: ProjectsApi;
  category: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { format: money } = useCurrency();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "actual" | "pending">("all");
  const [payment, setPayment] = useState<"all" | "paid" | "unpaid">("all");
  const [payer, setPayer] = useState<string>("all");

  const partnerName = (id: string | null) =>
    api.partners.find((p) => p.id === id)?.partner_name ?? "Partner";

  const all = useMemo<ProjectTransaction[]>(() => {
    if (!category) return [];
    return api.transactions.filter((t) => (t.category ?? "Uncategorised") === category);
  }, [api.transactions, category]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((t) => {
      if (state === "actual" && t.status !== "posted") return false;
      if (state === "pending" && t.status === "posted") return false;
      if (payment === "paid" && !t.is_paid) return false;
      if (payment === "unpaid" && t.is_paid) return false;
      if (payer !== "all") {
        const key = t.paid_by === "partner" ? `partner:${t.partner_id ?? ""}` : "company";
        if (key !== payer) return false;
      }
      if (!q) return true;
      return [t.description, t.vendor_name, t.notes, t.txn_date, String(t.amount)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, search, state, payment, payer]);

  const payerOptions = useMemo(() => {
    const set = new Map<string, string>();
    all.forEach((t) => {
      if (t.paid_by === "partner") set.set(`partner:${t.partner_id ?? ""}`, partnerName(t.partner_id));
      else set.set("company", "Company");
    });
    return [...set.entries()];
  }, [all, api.partners]);

  const total = rows.reduce((s, t) => s + Number(t.amount), 0);
  const actual = rows.filter((t) => t.status === "posted").reduce((s, t) => s + Number(t.amount), 0);
  const pending = total - actual;

  return (
    <Dialog open={!!category} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{category}</DialogTitle>
          <DialogDescription>
            Transactions behind this budget category. Posted rows count as actual; everything else is
            pending.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search description, vendor, amount…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="actual">Actual only</SelectItem>
              <SelectItem value="pending">Pending only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={payment} onValueChange={(v) => setPayment(v as typeof payment)}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Paid & unpaid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={payer} onValueChange={setPayer}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any payer</SelectItem>
              {payerOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">{rows.length} of {all.length} rows</Badge>
          <Badge variant="outline">Actual {money(actual)}</Badge>
          <Badge variant="outline">Pending {money(pending)}</Badge>
          <Badge>Total {money(total)}</Badge>
        </div>

        <ScrollArea className="max-h-[55vh] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap">{t.txn_date}</TableCell>
                  <TableCell>
                    <div className="max-w-[320px] truncate font-medium" title={t.description ?? ""}>
                      {t.description || t.vendor_name || "—"}
                    </div>
                    {t.vendor_name && t.description && (
                      <div className="text-xs text-muted-foreground">{t.vendor_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {t.paid_by === "partner" ? partnerName(t.partner_id) : "Company"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={t.status === "posted" ? "secondary" : "outline"}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      {!t.is_paid && <Badge variant="outline" className="text-[10px]">unpaid</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(Number(t.amount))}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No transactions match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}