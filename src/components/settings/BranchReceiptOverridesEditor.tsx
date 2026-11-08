import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Branch {
  id: string;
  name: string;
  is_primary: boolean;
}

interface Override {
  id: string;
  branch_id: string;
  address_ar: string | null;
  address_en: string | null;
  phone: string | null;
  terminal_id: string | null;
}

type Draft = {
  address_ar: string;
  address_en: string;
  phone: string;
  terminal_id: string;
};

const EMPTY: Draft = { address_ar: "", address_en: "", phone: "", terminal_id: "" };

export function BranchReceiptOverridesEditor() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const qc = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [dirty, setDirty] = useState(false);

  const branchesQ = useQuery({
    queryKey: ["branches-for-overrides", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, is_primary")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data as Branch[]) ?? [];
    },
  });

  const overridesQ = useQuery({
    queryKey: ["branch-receipt-overrides", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_receipt_overrides")
        .select("id, branch_id, address_ar, address_en, phone, terminal_id");
      if (error) throw error;
      return (data as Override[]) ?? [];
    },
  });

  const branches = branchesQ.data ?? [];
  const overrides = overridesQ.data ?? [];

  // Auto-select primary on first load
  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  const currentOverride = useMemo(
    () => overrides.find((o) => o.branch_id === selectedBranchId) ?? null,
    [overrides, selectedBranchId],
  );

  // Sync draft when selection or data changes
  useEffect(() => {
    if (!selectedBranchId) return;
    setDraft({
      address_ar: currentOverride?.address_ar ?? "",
      address_en: currentOverride?.address_en ?? "",
      phone: currentOverride?.phone ?? "",
      terminal_id: currentOverride?.terminal_id ?? "",
    });
    setDirty(false);
  }, [selectedBranchId, currentOverride]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId || !selectedBranchId) throw new Error("No branch selected");
      const payload = {
        tenant_id: tenantId,
        branch_id: selectedBranchId,
        address_ar: draft.address_ar.trim() || null,
        address_en: draft.address_en.trim() || null,
        phone: draft.phone.trim() || null,
        terminal_id: draft.terminal_id.trim() || null,
      };
      const { error } = await supabase
        .from("branch_receipt_overrides")
        .upsert(payload, { onConflict: "branch_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Branch override saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["branch-receipt-overrides", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const clear = useMutation({
    mutationFn: async () => {
      if (!currentOverride) return;
      const { error } = await supabase
        .from("branch_receipt_overrides")
        .delete()
        .eq("id", currentOverride.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Override cleared - branch will use tenant defaults");
      qc.invalidateQueries({ queryKey: ["branch-receipt-overrides", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const updateDraft = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Per-branch receipt overrides
        </CardTitle>
        <CardDescription>
          Override address, phone, and terminal # per branch. Empty fields fall
          back to the tenant-wide ZATCA settings above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {branchesQ.isLoading || overridesQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading branches…
          </div>
        ) : branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active branches yet. Add a branch first to configure overrides.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Branch</Label>
              <Select
                value={selectedBranchId ?? ""}
                onValueChange={(v) => setSelectedBranchId(v)}
              >
                <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} {b.is_primary ? "(primary)" : ""}
                      {overrides.some((o) => o.branch_id === b.id) ? " • overridden" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Address (English)</Label>
                <Input
                  value={draft.address_en}
                  placeholder="Leave empty to use tenant default"
                  onChange={(e) => updateDraft("address_en", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Address (Arabic)</Label>
                <Input
                  dir="rtl"
                  value={draft.address_ar}
                  placeholder="اتركه فارغاً لاستخدام الإعدادات الافتراضية"
                  onChange={(e) => updateDraft("address_ar", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input
                  value={draft.phone}
                  placeholder="+966 ..."
                  onChange={(e) => updateDraft("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Terminal #</Label>
                <Input
                  value={draft.terminal_id}
                  placeholder="T-001"
                  onChange={(e) => updateDraft("terminal_id", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                className="text-muted-foreground gap-2"
                disabled={!currentOverride || clear.isPending}
                onClick={() => clear.mutate()}
              >
                <Trash2 className="h-4 w-4" />
                Clear override
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="gap-2"
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save override
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}