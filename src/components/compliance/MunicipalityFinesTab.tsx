import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, Plus, Receipt } from "lucide-react";
import {
  FINE_STATUS_LABELS,
  type MunicipalityFine,
  type MunicipalityFineStatus,
} from "@/hooks/useMunicipalityFines";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  fines: MunicipalityFine[];
  totals: { count: number; amount: number; unpaid: number; unposted: number };
  isLoading: boolean;
  branchId: string | null;
  branchName: string;
  prefill?: Partial<MunicipalityFine> | null;
  onPrefillConsumed?: () => void;
  onSave: (input: Partial<MunicipalityFine> & { branch_id: string; fine_reference: string }) => Promise<unknown>;
  onPost: (id: string) => void;
  saving?: boolean;
  posting?: boolean;
}

export function MunicipalityFinesTab({
  fines,
  totals,
  isLoading,
  branchId,
  branchName,
  prefill,
  onPrefillConsumed,
  onSave,
  onPost,
  saving,
  posting,
}: Props) {
  const { format: money } = useCurrency();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const patch = (p: Record<string, unknown>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    if (prefill) {
      setForm({
        received_date: format(new Date(), "yyyy-MM-dd"),
        status: "received",
        amount: 0,
        ...prefill,
      });
      setOpen(true);
    }
  }, [prefill]);

  const newFine = () => {
    setForm({
      received_date: format(new Date(), "yyyy-MM-dd"),
      status: "received",
      amount: 0,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!branchId || !form.fine_reference) return;
    await onSave({
      ...(form as Partial<MunicipalityFine>),
      branch_id: (form.branch_id as string) ?? branchId,
      fine_reference: form.fine_reference as string,
    });
    setOpen(false);
    onPrefillConsumed?.();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Total fines</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-light">{money(totals.amount)}</p><p className="text-xs text-muted-foreground">{totals.count} notice(s)</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Unpaid / open</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-light text-destructive">{money(totals.unpaid)}</p><p className="text-xs text-muted-foreground">Awaiting payment or appeal outcome</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Not yet in accounts</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-light">{totals.unposted}</p><p className="text-xs text-muted-foreground">Post to expenses to hit the ledger</p></CardContent>
        </Card>
      </div>

      <Alert>
        <Landmark className="h-4 w-4" />
        <AlertTitle>Municipality fines are a business cost</AlertTitle>
        <AlertDescription className="text-xs">
          Posting a fine creates a normal branch expense so it flows through approval, payables and the
          P&amp;L. It never becomes an employee wage deduction.
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button size="sm" onClick={newFine}>
          <Plus className="mr-2 h-4 w-4" /> Register fine
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Accounting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : fines.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No municipality fines recorded.</TableCell></TableRow>
              ) : (
                fines.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">
                      <button className="hover:underline" onClick={() => { setForm({ ...f }); setOpen(true); }}>
                        {f.fine_reference}
                      </button>
                    </TableCell>
                    <TableCell>{f.branch?.name ?? "—"}</TableCell>
                    <TableCell>{format(new Date(f.received_date), "dd MMM yyyy")}</TableCell>
                    <TableCell>{f.due_date ?? "—"}</TableCell>
                    <TableCell><Badge variant={f.status === "paid" ? "secondary" : "outline"}>{FINE_STATUS_LABELS[f.status]}</Badge></TableCell>
                    <TableCell className="text-right">{money(Number(f.amount))}</TableCell>
                    <TableCell className="text-right">
                      {f.expense_id ? (
                        <Badge variant="secondary"><Receipt className="mr-1 h-3 w-3" /> Posted</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={posting} onClick={() => onPost(f.id)}>
                          Post to expenses
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onPrefillConsumed?.(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit municipality fine" : "Register municipality fine"}</DialogTitle>
            <DialogDescription>{branchName}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Fine reference">
                <Input value={(form.fine_reference as string) ?? ""} onChange={(e) => patch({ fine_reference: e.target.value })} />
              </Field>
              <Field label="Amount">
                <Input type="number" step="0.01" value={String(form.amount ?? 0)} onChange={(e) => patch({ amount: Number(e.target.value) })} />
              </Field>
              <Field label="Inspection date">
                <Input type="date" value={(form.inspection_date as string) ?? ""} onChange={(e) => patch({ inspection_date: e.target.value })} />
              </Field>
              <Field label="Received date">
                <Input type="date" value={(form.received_date as string) ?? ""} onChange={(e) => patch({ received_date: e.target.value })} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={(form.due_date as string) ?? ""} onChange={(e) => patch({ due_date: e.target.value })} />
              </Field>
              <Field label="Status">
                <Select value={(form.status as string) ?? "received"} onValueChange={(v) => patch({ status: v as MunicipalityFineStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FINE_STATUS_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment date">
                <Input type="date" value={(form.payment_date as string) ?? ""} onChange={(e) => patch({ payment_date: e.target.value })} />
              </Field>
              <Field label="Payment reference">
                <Input value={(form.payment_reference as string) ?? ""} onChange={(e) => patch({ payment_reference: e.target.value })} />
              </Field>
              <Field label="Appeal status">
                <Input value={(form.appeal_status as string) ?? ""} onChange={(e) => patch({ appeal_status: e.target.value })} placeholder="e.g. Submitted / Rejected / Reduced" />
              </Field>
              <Field label="Appeal reference">
                <Input value={(form.appeal_reference as string) ?? ""} onChange={(e) => patch({ appeal_reference: e.target.value })} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Violation summary">
                  <Textarea rows={3} value={(form.violation_summary as string) ?? ""} onChange={(e) => patch({ violation_summary: e.target.value })} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <Textarea rows={2} value={(form.notes as string) ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
                </Field>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !form.fine_reference || !branchId}>
              {saving ? "Saving…" : "Save fine"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}