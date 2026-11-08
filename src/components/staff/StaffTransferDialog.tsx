import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

interface StaffLite {
  id: string;
  name: string;
  assigned_branch_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staff: StaffLite | null;
}

export function StaffTransferDialog({ open, onOpenChange, staff }: Props) {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const [toBranchId, setToBranchId] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [retagOpenAdvances, setRetagOpenAdvances] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!staff || !restaurant?.id || !toBranchId) throw new Error("Missing fields");
      const { error } = await db.from("staff_branch_transfers" as any).insert({
        restaurant_id: restaurant.id,
        staff_id: staff.id,
        from_branch_id: staff.assigned_branch_id,
        to_branch_id: toBranchId,
        effective_date: effectiveDate,
        retag_open_advances: retagOpenAdvances,
        note: note || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["staff-advances"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.success(t("app.staff.transfer.success"), {
        description: t("app.staff.transfer.successDescription"),
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || t("app.staff.transfer.failed")),
  });

  const targetOptions = branches.filter((b) => b.is_active && b.id !== staff?.assigned_branch_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("app.staff.transfer.title")}</DialogTitle>
          <DialogDescription>
            {staff?.name} · {t("app.staff.transfer.currently")}{" "}
            {staff?.assigned_branch_id
              ? branches.find((b) => b.id === staff?.assigned_branch_id)?.name
               : t("branches.allBranches")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>{t("app.staff.transfer.newBranch")}</Label>
            <Select value={toBranchId} onValueChange={setToBranchId}>
              <SelectTrigger><SelectValue placeholder={t("app.staff.transfer.selectBranch")} /></SelectTrigger>
              <SelectContent>
                {targetOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("app.staff.transfer.effectiveDate")}</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
            <Checkbox
              checked={retagOpenAdvances}
              onCheckedChange={(v) => setRetagOpenAdvances(!!v)}
              className="mt-0.5"
            />
            <div className="text-sm">
              <div className="font-medium">{t("app.staff.transfer.retagAdvances")}</div>
              <div className="text-xs text-muted-foreground">
                {t("app.staff.transfer.retagHelp")}
              </div>
            </div>
          </label>
          <div className="space-y-1">
            <Label>{t("app.staff.transfer.note")}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            disabled={!toBranchId || transferMutation.isPending}
            onClick={() => transferMutation.mutate()}
          >
            {t("app.staff.transfer.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}