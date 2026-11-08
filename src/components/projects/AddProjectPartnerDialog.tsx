import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { useProjects } from "@/hooks/useProjects";
import { diluteForNewPartner } from "@/lib/ownershipBalance";

type ProjectsApi = ReturnType<typeof useProjects>;

export function AddProjectPartnerDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addPartner, updatePartner, partners, activeProject } = api;
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const [openingCapital, setOpeningCapital] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoAdjust, setAutoAdjust] = useState(true);

  const existingPct = partners.reduce((s, p) => s + Number(p.ownership_pct || 0), 0);
  const pctValue = Number(pct) || 0;
  const pctInvalid = pctValue < 0 || pctValue > 100;

  // Pro-rata dilution preview for the existing partners.
  const dilution = diluteForNewPartner(
    partners.map((p) => ({ id: p.id, name: p.partner_name, pct: Number(p.ownership_pct || 0) })),
    pctValue,
  );
  const newTotal = autoAdjust ? dilution.total : existingPct + pctValue;
  const exceeds = !autoAdjust && newTotal > 100.01;
  const balanced = Math.abs(newTotal - 100) < 0.01;
  const blocked = pctInvalid || exceeds || !balanced;

  const reset = () => {
    setName("");
    setPct("");
    setOpeningCapital("");
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Partner name is required.");
      return;
    }
    if (partners.some((p) => p.partner_name.trim().toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A partner with this name already exists on the project.");
      return;
    }
    if (pctInvalid) {
      toast.error("Ownership must be between 0% and 100%.");
      return;
    }
    if (exceeds) {
      toast.error(
        `Ownership would total ${newTotal.toFixed(2)}%. Reduce another partner's share first.`,
      );
      return;
    }
    if (!balanced) {
      toast.error(
        `Ownership must total exactly 100% — this allocation gives ${newTotal.toFixed(2)}%.`,
      );
      return;
    }
    setSaving(true);
    try {
      if (autoAdjust) {
        // Dilute existing partners first so the 100% ownership trigger never sees an overflow.
        for (const h of dilution.holders) {
          if (Math.abs(h.delta) < 0.005) continue;
          await updatePartner.mutateAsync({ id: h.id, patch: { ownership_pct: h.newPct } as any });
        }
      }
      await addPartner.mutateAsync({
        name: trimmed,
        ownershipPct: Number(pct) || 0,
        openingCapital: Number(openingCapital) || 0,
      });
      toast.success(
        autoAdjust && dilution.holders.some((h) => Math.abs(h.delta) >= 0.005)
          ? "Partner added and existing partners diluted pro-rata to keep ownership at 100%."
          : "Partner added with capital, loan and payable ledger accounts.",
      );
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add the partner.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add partner</DialogTitle>
          <DialogDescription>
            Adds a partner to {activeProject?.name ?? "this project"} and provisions their capital,
            loan and "due to partner" ledger accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Partner name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ownership %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                placeholder="0"
                aria-invalid={pctInvalid || exceeds}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Opening capital</Label>
              <Input
                type="number"
                value={openingCapital}
                onChange={(e) => setOpeningCapital(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border p-2">
            <div className="space-y-0.5">
              <p className="text-xs font-medium">Auto-adjust existing partners</p>
              <p className="text-xs text-muted-foreground">
                Existing shares are diluted pro-rata so ownership stays at exactly 100%.
              </p>
            </div>
            <Switch checked={autoAdjust} onCheckedChange={setAutoAdjust} aria-label="Auto-adjust ownership" />
          </div>

          {autoAdjust && pctValue > 0 && dilution.holders.length > 0 && (
            <div className="rounded-md border text-xs">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b px-2 py-1.5 font-medium text-muted-foreground">
                <span>Partner</span>
                <span className="text-right">Before</span>
                <span className="text-right">After</span>
              </div>
              {dilution.holders.map((h) => (
                <div key={h.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5">
                  <span className="truncate">{h.name}</span>
                  <span className="text-right text-muted-foreground">{h.pct.toFixed(2)}%</span>
                  <span className="text-right font-medium">{h.newPct.toFixed(2)}%</span>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t px-2 py-1.5">
                <span className="truncate">{name.trim() || "New partner"}</span>
                <span className="text-right text-muted-foreground">—</span>
                <span className="text-right font-medium">{dilution.newPartnerPct.toFixed(2)}%</span>
              </div>
            </div>
          )}

          <p
            className={`text-xs ${
              blocked ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            Ownership after adding: {newTotal.toFixed(2)}%
            {pctInvalid
              ? " — ownership must be between 0% and 100%."
              : exceeds
                ? " — this exceeds 100%. Reduce another partner's share first."
                : balanced
                  ? ""
                  : autoAdjust
                    ? " — adjust the new partner's share."
                    : " — adjust the other partners so the total reaches 100%."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || blocked}>
            {saving ? "Adding…" : "Add partner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
