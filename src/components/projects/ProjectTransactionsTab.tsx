import { useMemo, useState } from "react";
import { Plus, Upload, Search, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  FUNDING_LABELS,
  TREATMENT_LABELS,
  type ProjectTransaction,
  type useProjects,
} from "@/hooks/useProjects";
import { ProjectTransactionDialog } from "./ProjectTransactionDialog";
import { ProjectImportDialog } from "./ProjectImportDialog";
import { AutoCategoriseTransactionsDialog } from "./AutoCategoriseTransactionsDialog";

type ProjectsApi = ReturnType<typeof useProjects>;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  needs_review: "destructive",
  classified: "secondary",
  posted: "default",
  rejected: "outline",
  voided: "outline",
};

export function ProjectTransactionsTab({
  api,
  focusTransactionId,
}: {
  api: ProjectsApi;
  focusTransactionId?: string | null;
}) {
  const { format: money } = useCurrency();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editing, setEditing] = useState<ProjectTransaction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [autoMatchOpen, setAutoMatchOpen] = useState(false);

  const rows = useMemo(() => {
    const q0 = search.trim();
    if (focusTransactionId && !q0 && statusFilter === "all") {
      const focused = api.transactions.find((t) => t.id === focusTransactionId);
      if (focused) return [focused, ...api.transactions.filter((t) => t.id !== focusTransactionId)];
    }
    const q = search.trim().toLowerCase();
    return api.transactions.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!q) return true;
      return [t.vendor_name, t.description, t.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [api.transactions, search, statusFilter, focusTransactionId]);

  const partnerName = (id: string | null) =>
    api.partners.find((p) => p.id === id)?.partner_name ?? "—";

  const handlePost = async (t: ProjectTransaction) => {
    try {
      await api.postTransaction.mutateAsync(t.id);
      toast.success("Posted to the general ledger");
    } catch (e: any) {
      toast.error(readableError(e?.message));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search vendor, description, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="classified">Classified</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Import
        </Button>
        <Button variant="outline" onClick={() => setAutoMatchOpen(true)}>
          <Wand2 className="mr-2 h-4 w-4" /> Auto-match categories
        </Button>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Record cost
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead>Funding</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow
                  key={t.id}
                  className={t.id === focusTransactionId ? "bg-primary/5" : undefined}
                >
                  <TableCell className="whitespace-nowrap">{t.txn_date}</TableCell>
                  <TableCell>{t.vendor_name ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground" title={t.description ?? t.notes ?? ""}>
                    {t.description ?? t.notes ?? "—"}
                  </TableCell>
                  <TableCell>{t.category ?? "—"}</TableCell>
                  <TableCell>{t.treatment ? TREATMENT_LABELS[t.treatment] : "—"}</TableCell>
                  <TableCell>{t.paid_by === "partner" ? partnerName(t.partner_id) : "Company"}</TableCell>
                  <TableCell className="text-xs">
                    {t.funding_classification ? FUNDING_LABELS[t.funding_classification] : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(Number(t.amount))}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(t);
                          setDialogOpen(true);
                        }}
                      >
                        {t.status === "posted" ? "View" : "Classify"}
                      </Button>
                      {t.status === "classified" && (
                        <Button size="sm" onClick={() => handlePost(t)}>
                          Post
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProjectTransactionDialog
        api={api}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        transaction={editing}
      />
      <ProjectImportDialog api={api} open={importOpen} onOpenChange={setImportOpen} />
      <AutoCategoriseTransactionsDialog
        api={api}
        open={autoMatchOpen}
        onOpenChange={setAutoMatchOpen}
      />
    </div>
  );
}

export function readableError(message?: string) {
  if (!message) return "Something went wrong";
  if (message.includes("NEEDS_REVIEW"))
    return "Classify this transaction (treatment and funding) before posting it.";
  if (message.includes("PARTNER_REQUIRED")) return "Select which partner paid this transaction.";
  if (message.includes("CLASSIFICATION_REQUIRED"))
    return "Choose whether the partner funding is capital, a loan, or money owed back.";
  if (message.includes("TREATMENT_REQUIRED")) return "Choose CAPEX / OPEX / pre-opening before posting.";
  if (message.includes("ACCOUNT_REQUIRED")) return "Choose a cost account or add split lines.";
  if (message.includes("SPLIT_MISMATCH")) return "Split lines must add up to the transaction amount exactly.";
  if (message.includes("ALLOCATION_INCOMPLETE"))
    return "The acquisition allocation must equal the purchase price exactly.";
  if (message.includes("NOT_AUTHORIZED")) return "Only finance roles can perform this action.";
  if (message.includes("ALREADY_POSTED")) return "This entry is already posted.";
  return message;
}