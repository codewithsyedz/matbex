import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Owner-only card that lets the owner allow accountants to post journal
 * entries and ledger transactions. Backed by
 * `tenants.accountant_can_post_journals`; RLS enforces the same rule
 * server-side via `can_post_journal_entries(tenant_id)`.
 */
export function AccountantPermissionsCard() {
  const { tenant, isOwner, refreshProfile } = useAuth();
  const initial = tenant?.accountant_can_post_journals === true;
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);

  if (!isOwner || !tenant) return null;

  const handleToggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next);
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      // Cast needed until generated types include the new column
      .update({ accountant_can_post_journals: next } as never)
      .eq("id", tenant.id);
    setSaving(false);
    if (error) {
      setEnabled(prev);
      toast.error("Failed to update accountant permissions", {
        description: error.message,
      });
      return;
    }
    await refreshProfile();
    toast.success(
      next
        ? "Accountants can now post journal entries"
        : "Accountants are back to read-only access",
    );
  };

  return (
    <div
      className="rounded-lg border bg-card p-5 fade-slide-in"
      style={{ animationDelay: "85ms" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600">
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="accountant-journal-toggle"
              className="text-sm font-semibold cursor-pointer"
            >
              Allow accountants to post journal entries
            </Label>
            <p className="text-xs text-muted-foreground max-w-xl">
              When enabled, users with the Accountant role can create journal
              entries and ledger transactions in the Accounting module. They
              still cannot edit POS, inventory, or settings. Turn this off at
              any time to revert accountants to read-only access.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saving && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Switch
            id="accountant-journal-toggle"
            checked={enabled}
            disabled={saving}
            onCheckedChange={handleToggle}
          />
        </div>
      </div>
    </div>
  );
}
