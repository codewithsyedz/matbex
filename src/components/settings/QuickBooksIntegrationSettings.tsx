import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Link2, Unlink, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Intuit requires the redirect URI to match the value registered in the
// developer portal exactly, so we pin it to the live product domain.
const PRODUCT_REDIRECT_URI = "https://www.matbex.com/quickbooks/callback";

function authUrlFor(clientId: string, integrationId: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: PRODUCT_REDIRECT_URI,
    state: integrationId,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

type QboAccount = {
  id: string;
  name: string;
  type?: string;
  sub_type?: string;
  classification?: string;
  active?: boolean;
};

export function QuickBooksIntegrationSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [accounts, setAccounts] = useState<QboAccount[] | null>(null);

  useEffect(() => {
    const qb = searchParams.get("quickbooks");
    if (qb === "connected") {
      toast.success("QuickBooks connected successfully");
      searchParams.delete("quickbooks");
      setSearchParams(searchParams, { replace: true });
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    } else if (qb === "error") {
      const err = searchParams.get("error") ?? "Unknown error";
      toast.error(`QuickBooks connection failed: ${err}`);
      searchParams.delete("quickbooks");
      searchParams.delete("error");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, qc]);

  const { data: tenantId } = useQuery({
    queryKey: ["my-tenant-id", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).maybeSingle();
      return data?.tenant_id as string | null;
    },
    enabled: !!user,
  });

  const { data: integration, isLoading } = useQuery({
    queryKey: ["accounting-integration", tenantId, "quickbooks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounting_integrations")
        .select("id, organization_id, organization_name, status, auto_sync_enabled, last_sync_at, last_error, client_id, client_secret, settings")
        .eq("tenant_id", tenantId!).eq("provider", "quickbooks").maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (integration) {
      setClientId(integration.client_id ?? "");
      setClientSecret(integration.client_secret ?? "");
      setSandbox(Boolean((integration.settings as any)?.sandbox));
    }
  }, [integration]);

  const { data: logs } = useQuery({
    queryKey: ["accounting-sync-log", integration?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounting_sync_log")
        .select("id, entity_type, direction, status, error_message, synced_at")
        .eq("integration_id", integration!.id).order("synced_at", { ascending: false }).limit(20);
      return data ?? [];
    },
    enabled: !!integration?.id,
  });

  const saveCreds = useMutation({
    mutationFn: async () => {
      if (!clientId.trim() || !clientSecret.trim()) throw new Error("Client ID and Client Secret are required");
      if (!tenantId) throw new Error("Tenant not found");

      if (integration) {
        const { error } = await supabase.from("accounting_integrations")
          .update({
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            settings: { ...((integration.settings as any) ?? {}), sandbox },
          })
          .eq("id", integration.id);
        if (error) throw error;
        return integration.id;
      }
      const { data, error } = await supabase.from("accounting_integrations")
        .insert({
          tenant_id: tenantId, provider: "quickbooks", region: "com",
          client_id: clientId.trim(), client_secret: clientSecret.trim(),
          settings: { sandbox },
          status: "disconnected", connected_by: user?.id,
        }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => {
      toast.success("QuickBooks credentials saved");
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save credentials"),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!integration) return;
      const { error } = await supabase.from("accounting_integrations")
        .update({
          access_token: null, refresh_token: null, token_expires_at: null,
          status: "disconnected", organization_id: null, organization_name: null,
        })
        .eq("id", integration.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setAccounts(null);
      toast.success("Disconnected from QuickBooks");
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to disconnect"),
  });

  const invokeSync = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("quickbooks-sync", {
      body: { integration_id: integration!.id, ...payload },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const testConn = useMutation({
    mutationFn: async () => {
      if (!integration) throw new Error("No integration");
      return invokeSync({ action: "test" });
    },
    onSuccess: (d: any) => {
      toast.success(`Connected to ${d.company_name ?? "QuickBooks company"}`);
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Test failed"),
  });

  const pullAccounts = useMutation({
    mutationFn: async () => {
      if (!integration) throw new Error("No integration");
      return invokeSync({ action: "pull_chart_of_accounts" });
    },
    onSuccess: (d: any) => {
      setAccounts(d.accounts ?? []);
      toast.success(`Fetched ${(d.accounts ?? []).length} QuickBooks accounts`);
      qc.invalidateQueries({ queryKey: ["accounting-sync-log"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to pull chart of accounts"),
  });

  const startOAuth = () => {
    if (!integration?.id || !integration.client_id) {
      toast.error("Save Client ID and Secret first");
      return;
    }
    window.location.href = authUrlFor(integration.client_id, integration.id);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const isConnected = integration?.status === "connected";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            QuickBooks Online
            {isConnected ? (
              <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
                <CheckCircle2 className="h-3 w-3 mr-1" />Connected
              </Badge>
            ) : (
              <Badge variant="outline">Not connected</Badge>
            )}
          </CardTitle>
          <CardDescription className="mt-1">
            Sync your chart of accounts and push daily journal entries to QuickBooks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Setup steps in Intuit</AlertTitle>
            <AlertDescription className="space-y-2 text-sm">
              <ol className="list-decimal ml-5 space-y-1">
                <li>
                  Go to{" "}
                  <a href="https://developer.intuit.com/app/developer/dashboard" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1">
                    developer.intuit.com <ExternalLink className="h-3 w-3" />
                  </a>{" "}and create an app with the <strong>Accounting</strong> scope.
                </li>
                <li>
                  Add this exact Redirect URI:
                  <div className="mt-1 p-2 rounded bg-muted font-mono text-xs break-all">{PRODUCT_REDIRECT_URI}</div>
                </li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below (production keys unless you enable Sandbox).</li>
              </ol>
            </AlertDescription>
          </Alert>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="qbo-client-id">Client ID</Label>
              <Input id="qbo-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ABxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qbo-client-secret">Client Secret</Label>
              <Input id="qbo-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••••" autoComplete="off" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Sandbox company</Label>
              <p className="text-xs text-muted-foreground">Use Intuit's sandbox API instead of production</p>
            </div>
            <Switch checked={sandbox} onCheckedChange={setSandbox} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveCreds.mutate()} disabled={saveCreds.isPending}>
              {saveCreds.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save credentials
            </Button>
            {!isConnected ? (
              <Button onClick={startOAuth} disabled={!integration?.client_id}>
                <Link2 className="h-4 w-4 mr-2" />Connect to QuickBooks
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => testConn.mutate()} disabled={testConn.isPending}>
                  {testConn.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Test connection
                </Button>
                <Button variant="outline" onClick={() => pullAccounts.mutate()} disabled={pullAccounts.isPending}>
                  {pullAccounts.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Pull chart of accounts
                </Button>
                <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                  <Unlink className="h-4 w-4 mr-2" />Disconnect
                </Button>
              </>
            )}
          </div>

          {integration?.last_error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Last error</AlertTitle>
              <AlertDescription className="text-xs break-all">{integration.last_error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {isConnected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Company</CardTitle>
            <CardDescription>
              {integration?.organization_name ?? "Unknown company"}{" "}
              <span className="text-xs text-muted-foreground">(Realm ID: {integration?.organization_id})</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-sync</Label>
                <p className="text-xs text-muted-foreground">Run scheduled sync automatically</p>
              </div>
              <Switch
                checked={!!integration?.auto_sync_enabled}
                onCheckedChange={async (v) => {
                  await supabase.from("accounting_integrations").update({ auto_sync_enabled: v }).eq("id", integration!.id);
                  qc.invalidateQueries({ queryKey: ["accounting-integration"] });
                }}
              />
            </div>
            <Separator />
            <div className="text-xs text-muted-foreground">
              Last sync: {integration?.last_sync_at ? new Date(integration.last_sync_at).toLocaleString() : "Never"}
            </div>
          </CardContent>
        </Card>
      )}

      {!!accounts?.length && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">QuickBooks chart of accounts</CardTitle>
            <CardDescription>{accounts.length} accounts — use these IDs when mapping Matbex accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto space-y-1 text-sm">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between border-b border-border/40 py-1.5 gap-3">
                  <span className="truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {a.type ?? "—"} · #{a.id}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!!logs?.length && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Recent sync activity</CardTitle>
            <CardDescription>Last 20 events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={log.status === "success" ? "default" : log.status === "error" ? "destructive" : "outline"} className="text-[10px]">
                      {log.status}
                    </Badge>
                    <span className="text-muted-foreground">{log.direction}</span>
                    <span>{log.entity_type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(log.synced_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}