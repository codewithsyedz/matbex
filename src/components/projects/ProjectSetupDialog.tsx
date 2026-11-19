import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/hooks/useProjects";
import { rebalanceDrafts, round2 } from "@/lib/ownershipBalance";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PartnerDraft {
  name: string;
  pct: string;
}

export function ProjectSetupDialog({ open, onOpenChange }: Props) {
  const { profile } = useAuth();
  const { createProject, addPartner } = useProjects();

  const [code, setCode] = useState("KG-001");
  const [name, setName] = useState("Karahi GUYZ Setup & Construction");
  const [budget, setBudget] = useState("");
  const [partners, setPartners] = useState<PartnerDraft[]>([
    { name: "Fraz", pct: "51" },
    { name: "Syed Raza", pct: "49" },
  ]);
  const [saving, setSaving] = useState(false);
  const [autoBalance, setAutoBalance] = useState(true);

  /** Scales every other partner pro-rata so the register stays at exactly 100%. */
  const applyBalance = (list: PartnerDraft[], changedIndex: number): PartnerDraft[] => {
    const next = rebalanceDrafts(list.map((p) => Number(p.pct) || 0), changedIndex);
    return list.map((p, i) => ({ ...p, pct: String(next[i]) }));
  };

  const setPartner = (i: number, patch: Partial<PartnerDraft>) =>
    setPartners((prev) => {
      const updated = prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
      if (!autoBalance || patch.pct === undefined) return updated;
      return applyBalance(updated, i);
    });

  const addPartnerRow = () =>
    setPartners((prev) => {
      const list = [...prev, { name: "", pct: "0" }];
      if (!autoBalance) return list;
      // Give the newcomer an equal share and dilute the others pro-rata.
      const share = round2(100 / list.length);
      list[list.length - 1] = { name: "", pct: String(share) };
      return applyBalance(list, list.length - 1);
    });

  const removePartner = (i: number) =>
    setPartners((prev) => {
      if (prev.length <= 1) return prev;
      const list = prev.filter((_, idx) => idx !== i);
      if (!autoBalance) return list;
      // Redistribute the freed share pro-rata across whoever remains.
      return rebalanceRemaining(list);
    });

  const rebalanceRemaining = (list: PartnerDraft[]): PartnerDraft[] => {
    const total = list.reduce((s, p) => s + (Number(p.pct) || 0), 0);
    if (total <= 0) {
      const each = round2(100 / list.length);
      return list.map((p) => ({ ...p, pct: String(each) }));
    }
    const scaled = list.map((p) => ({ ...p, pct: String(round2(((Number(p.pct) || 0) * 100) / total)) }));
    const sum = scaled.reduce((s, p) => s + Number(p.pct), 0);
    const residual = round2(100 - sum);
    if (Math.abs(residual) >= 0.01) {
      let big = 0;
      scaled.forEach((p, i) => {
        if (Number(p.pct) > Number(scaled[big].pct)) big = i;
      });
      scaled[big] = { ...scaled[big], pct: String(round2(Number(scaled[big].pct) + residual)) };
    }
    return scaled;
  };

  const namedPartners = partners.filter((p) => p.name.trim());
  const totalPct = namedPartners.reduce((s, p) => s + (Number(p.pct) || 0), 0);
  const hasInvalidPct = namedPartners.some((p) => {
    const v = Number(p.pct);
    return !Number.isFinite(v) || v < 0 || v > 100;
  });
  const pctExceeds = totalPct > 100.01;
  const pctBalanced = namedPartners.length === 0 || Math.abs(totalPct - 100) < 0.01;
  const saveBlocked = hasInvalidPct || pctExceeds || !pctBalanced;

  const handleSave = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Project code and name are required");
      return;
    }
    if (hasInvalidPct) {
      toast.error("Each partner's ownership must be between 0% and 100%.");
      return;
    }
    if (pctExceeds) {
      toast.error(`Ownership totals ${totalPct.toFixed(2)}% — it cannot exceed 100%.`);
      return;
    }
    if (!pctBalanced) {
      toast.error(`Ownership must total exactly 100% — currently ${totalPct.toFixed(2)}%.`);
      return;
    }
    setSaving(true);
    try {
      const seen = new Set<string>();
      for (const p of namedPartners) {
        const key = p.name.trim().toLowerCase();
        if (seen.has(key)) {
          toast.error(`Duplicate partner name: ${p.name.trim()}`);
          setSaving(false);
          return;
        }
        seen.add(key);
      }
      const project = await createProject.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        restaurantId: profile?.restaurant_id ?? null,
        totalBudget: Number(budget) || 0,
        seedBudgetCategories: true,
      });
      for (const p of partners.filter((x) => x.name.trim())) {
        await addPartnerTo(project.id, p);
      }
      toast.success("Project created with partner ledger accounts");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the project");
    } finally {
      setSaving(false);
    }
  };

  // addPartner from the hook binds to the currently-active project, so partners for a
  // freshly created project are inserted directly against its id.
  const addPartnerTo = async (projectId: string, p: PartnerDraft) => {
    const { db } = await import("@/integrations/db/client");
    const { data, error } = await db
      .from("project_partners")
      .insert({
        tenant_id: profile?.tenant_id,
        project_id: projectId,
        partner_name: p.name.trim(),
        ownership_pct: Number(p.pct) || 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: rpcErr } = await db.rpc("ensure_partner_funding_accounts", { p_partner_id: data.id });
    if (rpcErr) throw rpcErr;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New project / cost centre</DialogTitle>
          <DialogDescription>
            Tracks acquisition and construction spend separately from operating results. Partners each get a
            capital, loan and "due to partner" ledger account.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KG-001" />
              </div>
              <div className="space-y-1.5">
                <Label>Total budget (optional)</Label>
                <Input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Project name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Partners</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addPartnerRow}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add partner
                </Button>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Auto-adjust existing partners</p>
                  <p className="text-xs text-muted-foreground">
                    Adding a partner or changing a share dilutes the others pro-rata so the total stays
                    at 100%.
                  </p>
                </div>
                <Switch checked={autoBalance} onCheckedChange={setAutoBalance} aria-label="Auto-adjust ownership" />
              </div>
              <p className="text-xs text-muted-foreground">
                Ownership percentage is independent of how much each partner actually funds.
              </p>
              {partners.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_36px] items-center gap-2">
                  <Input
                    value={p.name}
                    placeholder="Partner name"
                    onChange={(e) => setPartner(i, { name: e.target.value })}
                  />
                  <Input
                    value={p.pct}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="%"
                    onChange={(e) => setPartner(i, { pct: e.target.value })}
                    aria-invalid={
                      !Number.isFinite(Number(p.pct)) || Number(p.pct) < 0 || Number(p.pct) > 100
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    disabled={partners.length <= 1}
                    onClick={() => removePartner(i)}
                    aria-label={`Remove partner ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {namedPartners.length} partner{namedPartners.length === 1 ? "" : "s"}
                </span>
                <span className={saveBlocked ? "text-destructive" : "text-muted-foreground"}>
                  Ownership total: {totalPct.toFixed(2)}%
                  {pctExceeds
                    ? " (cannot exceed 100%)"
                    : hasInvalidPct
                      ? " (each share must be 0–100%)"
                      : pctBalanced
                        ? ""
                        : " (should be 100%)"}
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || saveBlocked}>
            {saving ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}