import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Download, Loader2, FileJson, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Format = "json" | "csv";

function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

export function ExportCoATemplateButton() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const [open, setOpen] = useState(false);
  const [includeCoA, setIncludeCoA] = useState(true);
  const [includeMappings, setIncludeMappings] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [fmt, setFmt] = useState<Format>("json");
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (!tenantId) {
      toast.error("No tenant context");
      return;
    }
    if (!includeCoA && !includeMappings) {
      toast.error("Select at least one dataset to export");
      return;
    }
    setBusy(true);
    try {
      let coa: any[] = [];
      let mappings: any[] = [];

      if (includeCoA) {
        let q = supabase
          .from("chart_of_accounts")
          .select(
            "account_code, account_name, account_type, description, is_system_account, is_active, parent_id"
          )
          .eq("tenant_id", tenantId)
          .order("account_code", { ascending: true });
        if (activeOnly) q = q.eq("is_active", true);
        if (!includeSystem) q = q.eq("is_system_account", false);
        const { data, error } = await q;
        if (error) throw error;
        // Resolve parent_id → parent_account_code for portability across tenants
        const byId = new Map((data || []).map((r: any) => [r.parent_id, r]));
        const byPk = new Map<string, string>();
        // We need a second lookup to map UUIDs to codes
        const { data: allRows } = await supabase
          .from("chart_of_accounts")
          .select("id, account_code")
          .eq("tenant_id", tenantId);
        (allRows || []).forEach((r: any) => byPk.set(r.id, r.account_code));
        coa = (data || []).map((r: any) => ({
          account_code: r.account_code,
          account_name: r.account_name,
          account_type: r.account_type,
          description: r.description ?? "",
          is_system_account: r.is_system_account,
          is_active: r.is_active,
          parent_account_code: r.parent_id ? byPk.get(r.parent_id) ?? "" : "",
        }));
      }

      if (includeMappings) {
        const { data, error } = await supabase
          .from("accounting_account_mappings")
          .select(
            "matbex_account_code, matbex_account_name, external_account_id, external_account_name, external_account_type, integration_id"
          )
          .eq("tenant_id", tenantId)
          .order("matbex_account_code", { ascending: true });
        if (error) throw error;
        mappings = data || [];
      }

      const stamp = new Date().toISOString().slice(0, 10);
      if (fmt === "json") {
        const payload = {
          version: 1,
          exported_at: new Date().toISOString(),
          tenant_id: tenantId,
          chart_of_accounts: includeCoA ? coa : undefined,
          account_mappings: includeMappings ? mappings : undefined,
        };
        downloadBlob(
          `coa-template-${stamp}.json`,
          "application/json",
          JSON.stringify(payload, null, 2)
        );
      } else {
        if (includeCoA) {
          downloadBlob(
            `chart-of-accounts-${stamp}.csv`,
            "text/csv",
            toCsv(coa)
          );
        }
        if (includeMappings) {
          downloadBlob(
            `account-mappings-${stamp}.csv`,
            "text/csv",
            toCsv(mappings)
          );
        }
      }

      toast.success(
        `Exported ${includeCoA ? coa.length + " accounts" : ""}${
          includeCoA && includeMappings ? ", " : ""
        }${includeMappings ? mappings.length + " mappings" : ""}`
      );
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Download className="h-4 w-4" />
          Export template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export CoA & Mappings template</DialogTitle>
          <DialogDescription>
            Download a reusable template of your Chart of Accounts and accounting
            integration mappings. Use it to seed another branch or organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Datasets</Label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={includeCoA}
                onCheckedChange={(c) => setIncludeCoA(!!c)}
                className="mt-0.5"
              />
              <span>Chart of Accounts</span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={includeMappings}
                onCheckedChange={(c) => setIncludeMappings(!!c)}
                className="mt-0.5"
              />
              <span>Account Mappings (external integrations)</span>
            </label>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">CoA filters</Label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={activeOnly}
                onCheckedChange={(c) => setActiveOnly(!!c)}
                disabled={!includeCoA}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">Active accounts only</span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={includeSystem}
                onCheckedChange={(c) => setIncludeSystem(!!c)}
                disabled={!includeCoA}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                Include system accounts
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Format</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={fmt === "json" ? "default" : "outline"}
                size="sm"
                onClick={() => setFmt("json")}
                className="gap-1.5"
              >
                <FileJson className="h-4 w-4" /> JSON
              </Button>
              <Button
                type="button"
                variant={fmt === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setFmt("csv")}
                className="gap-1.5"
              >
                <FileSpreadsheet className="h-4 w-4" /> CSV
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              JSON keeps both datasets in one file with version metadata. CSV
              produces one file per dataset.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={busy} className="gap-1.5">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
