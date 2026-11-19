import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ReverseExpenseVatDialog({ expense, onClose, onReversed }: {
  expense: { id: string; amount: number; vat_amount?: number | null } | null;
  onClose: () => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = useState("");
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { format: money } = useCurrency();
  const qc = useQueryClient();
  useEffect(() => setReason(""), [expense?.id]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!expense) throw new Error("No expense selected");
      const { error } = await db.rpc("reverse_expense_vat", { p_expense_id: expense.id, p_reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success(ar ? "تم عكس ضريبة المصروف" : "Expense VAT reversed");
      onReversed();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return <Dialog open={!!expense} onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="max-w-md" dir={ar ? "rtl" : "ltr"}>
      <DialogHeader><DialogTitle>{ar ? "عكس ضريبة المصروف" : "Reverse expense VAT"}</DialogTitle></DialogHeader>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>{ar ? "ضريبة سيتم عكسها" : "VAT to reverse"}</dt><dd className="text-end tabular-nums">{money(Number(expense?.vat_amount || 0))}</dd>
        <dt>{ar ? "الإجمالي دون تغيير" : "Total unchanged"}</dt><dd className="text-end tabular-nums">{money(Number(expense?.amount || 0))}</dd>
      </dl>
      <div className="space-y-2"><Label htmlFor="vat-reversal-reason">{ar ? "سبب التصحيح" : "Correction reason"}</Label>
        <Textarea id="vat-reversal-reason" value={reason} onChange={e => setReason(e.target.value)} disabled={mutation.isPending} />
      </div>
      <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
        <Button disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>{ar ? "عكس الضريبة" : "Reverse VAT"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}