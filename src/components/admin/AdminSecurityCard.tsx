import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSessionSecurity } from "@/hooks/useSessionSecurity";
import { useSuperAdminAudit } from "@/hooks/useSuperAdminAudit";

/** SuperAdmin → Settings: two-factor for owners of paying businesses, and the admin IP allow-list. */
export function AdminSecurityCard() {
  const qc = useQueryClient();
  const security = useSessionSecurity();
  const { logEvent } = useSuperAdminAudit();
  const settings = useQuery({
    queryKey: ["admin-security-settings"],
    queryFn: async () => {
      const { data, error } = await db.from("platform_settings").select("key, value").in("key", ["security", "admin_access"]);
      if (error) throw error;
      const get = (k: string) => (data ?? []).find((r) => r.key === k)?.value as Record<string, unknown> | undefined;
      return {
        ownerMfa: get("security")?.owner_mfa_required === true,
        ips: Array.isArray(get("admin_access")?.ip_allowlist) ? (get("admin_access")!.ip_allowlist as string[]) : [],
      };
    },
  });
  const [ips, setIps] = useState("");
  useEffect(() => { if (settings.data) setIps(settings.data.ips.join("\n")); }, [settings.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-security-settings"] });
    void qc.invalidateQueries({ queryKey: ["session-security"] });
  };

  const setOwnerMfa = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.from("platform_settings").upsert(
        { key: "security", value: { owner_mfa_required: on }, is_secret: false, description: "Platform security rules" },
        { onConflict: "key" },
      );
      if (error) throw error;
      await logEvent({ actionType: "SECURITY_SETTING_CHANGE", targetType: "setting", targetIdentifier: "security.owner_mfa_required", metadataAfter: { owner_mfa_required: on }, summary: `Two-factor for paying owners turned ${on ? "on" : "off"}` });
    },
    onSuccess: (_d, on) => { toast.success(on ? "Owners of paying businesses must now use two-factor" : "Owner two-factor rule turned off"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveIps = useMutation({
    mutationFn: async () => {
      const cidrs = ips.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const { error } = await db.rpc("set_admin_ip_allowlist", { _cidrs: cidrs });
      if (error) throw error;
      await logEvent({ actionType: "SECURITY_SETTING_CHANGE", targetType: "setting", targetIdentifier: "admin_access.ip_allowlist", metadataBefore: { ip_allowlist: settings.data?.ips ?? [] }, metadataAfter: { ip_allowlist: cidrs }, summary: `SuperAdmin IP allow-list: ${cidrs.length ? `${cidrs.length} entries` : "any network"}` });
    },
    onSuccess: () => { toast.success("Allow-list saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const myIp = security.data?.client_ip;

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium"><Lock className="h-4 w-4" />Admin security</CardTitle>
        <CardDescription>Extra protection for the accounts that can reach money and customer data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm">
                <Label htmlFor="owner-mfa">Require two-factor for owners of paying businesses</Label>
                <p className="text-muted-foreground">On their next visit owners set up an authenticator app; the app and API stay closed to them until they enter a code. Trials and Free are not affected.</p>
              </div>
              <Switch id="owner-mfa" checked={settings.data?.ownerMfa ?? false} disabled={setOwnerMfa.isPending} onCheckedChange={(v) => setOwnerMfa.mutate(v)} />
            </div>
            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="admin-ips">SuperAdmin IP allow-list</Label>
              <Textarea id="admin-ips" rows={3} className="font-mono text-sm" value={ips} onChange={(e) => setIps(e.target.value)} placeholder={"203.0.113.4\n198.51.100.0/24"} />
              <p className="text-xs text-muted-foreground">
                One address or range per line. Empty allows any network. {myIp ? `Your address now: ${myIp}; it must be on the list.` : "No public address detected for this session."}
              </p>
              <Button size="sm" onClick={() => saveIps.mutate()} disabled={saveIps.isPending}>
                {saveIps.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save allow-list
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
