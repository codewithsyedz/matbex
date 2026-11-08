import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Link2, Unlink, RefreshCw, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const ZOHO_REGIONS = [
  { value: "sa", label: "Saudi Arabia (.sa)" },
  { value: "com", label: "Global (.com)" },
  { value: "eu", label: "Europe (.eu)" },
  { value: "in", label: "India (.in)" },
  { value: "com.au", label: "Australia (.com.au)" },
  { value: "jp", label: "Japan (.jp)" },
];

// Always use the production product domain for the Zoho redirect URI.
// Zoho requires the redirect URI registered in the API console to match
// exactly, so we pin it to the live domain regardless of where the app
// is currently being viewed (preview, localhost, etc.).
const PRODUCT_REDIRECT_URI = "https://www.matbex.com/zoho/callback";
function buildRedirectUri() {
  return PRODUCT_REDIRECT_URI;
}

function authUrlFor(region: string, clientId: string, integrationId: string) {
  const domain = {
    sa: "accounts.zoho.sa", com: "accounts.zoho.com", eu: "accounts.zoho.eu",
    in: "accounts.zoho.in", "com.au": "accounts.zoho.com.au", jp: "accounts.zoho.jp",
  }[region] ?? "accounts.zoho.com";
  const redirectUri = buildRedirectUri();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "ZohoBooks.fullaccess.all",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    state: integrationId,
  });
  return `https://${domain}/oauth/v2/auth?${params.toString()}`;
}

export function AccountingIntegrationSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [region, setRegion] = useState("sa");

  // Handle OAuth callback feedback
  useEffect(() => {
    const zoho = searchParams.get("zoho");
    if (zoho === "connected") {
      toast.success("Zoho Books connected successfully");
      searchParams.delete("zoho");
      setSearchParams(searchParams, { replace: true });
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    } else if (zoho === "error") {
      const err = searchParams.get("error") ?? "Unknown error";
      toast.error(`Zoho connection failed: ${err}`);
      searchParams.delete("zoho");
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
    queryKey: ["accounting-integration", tenantId, "zoho_books"],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounting_integrations")
        .select("id, region, organization_id, organization_name, status, auto_sync_enabled, sync_frequency, last_sync_at, last_error, client_id, client_secret")
        .eq("tenant_id", tenantId!).eq("provider", "zoho_books").maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (integration) {
      setClientId(integration.client_id ?? "");
      setClientSecret(integration.client_secret ?? "");
      setRegion(integration.region ?? "sa");
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
          .update({ client_id: clientId.trim(), client_secret: clientSecret.trim(), region })
          .eq("id", integration.id);
        if (error) throw error;
        return integration.id;
      } else {
        const { data, error } = await supabase.from("accounting_integrations")
          .insert({
            tenant_id: tenantId, provider: "zoho_books", region,
            client_id: clientId.trim(), client_secret: clientSecret.trim(),
            status: "disconnected", connected_by: user?.id,
          }).select("id").single();
        if (error) throw error;
        return data.id;
      }
    },
    onSuccess: () => {
      toast.success("Zoho credentials saved");
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save credentials"),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!integration) return;
      const { error } = await supabase.from("accounting_integrations")
        .update({ access_token: null, refresh_token: null, token_expires_at: null, status: "disconnected", organization_id: null, organization_name: null })
        .eq("id", integration.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Disconnected from Zoho");
      qc.invalidateQueries({ queryKey: ["accounting-integration"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to disconnect"),
  });

  const testConn = useMutation({
    mutationFn: async () => {
      if (!integration) throw new Error("No integration");
      const { data, error } = await supabase.functions.invoke("zoho-sync", {
        body: { action: "test", integration_id: integration.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => toast.success(`Connection OK (${d.organizations_count ?? 0} orgs available)`),
    onError: (e: any) => toast.error(e.message ?? "Test failed"),
  });

  const startOAuth = () => {
    if (!integration?.id || !integration.client_id) {
      toast.error("Save Client ID and Secret first");
      return;
    }
    const url = authUrlFor(integration.region, integration.client_id, integration.id);
    window.location.href = url;
  };

  const callbackUrl = buildRedirectUri();

  if (isLoading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const isConnected = integration?.status === "connected";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                Zoho Books
                {isConnected ? (
                  <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" />Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not connected</Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                Two-way sync of journals, chart of accounts, invoices and bills.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Setup steps in Zoho</AlertTitle>
            <AlertDescription className="space-y-2 text-sm">
              <ol className="list-decimal ml-5 space-y-1">
                <li>Go to{" "}
                  <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1">
                    api-console.zoho.com <ExternalLink className="h-3 w-3" />
                  </a>{" "}and create a <strong>Server-based Application</strong>.
                </li>
                <li>Add this exact Redirect URI:
                  <div className="mt-1 p-2 rounded bg-muted font-mono text-xs break-all">{callbackUrl}</div>
                </li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below.</li>
                <li>Ensure the scope <code className="text-xs">ZohoBooks.fullaccess.all</code> is enabled.</li>
              </ol>
            </AlertDescription>
          </Alert>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="zoho-client-id">Client ID</Label>
              <Input id="zoho-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1000.XXXXXXXXXXXXXX" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zoho-client-secret">Client Secret</Label>
              <Input id="zoho-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••••" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Data Center</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ZOHO_REGIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveCreds.mutate()} disabled={saveCreds.isPending}>
              {saveCreds.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save credentials
            </Button>
            {!isConnected ? (
              <Button variant="default" onClick={startOAuth} disabled={!integration?.client_id}>
                <Link2 className="h-4 w-4 mr-2" />Connect to Zoho Books
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => testConn.mutate()} disabled={testConn.isPending}>
                  {testConn.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Test connection
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
            <CardTitle className="text-base font-medium">Sync settings</CardTitle>
            <CardDescription>
              Organization: <strong>{integration?.organization_name ?? integration?.organization_id ?? "- pick one via Test/Setup -"}</strong>
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

      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">More providers</CardTitle>
          <CardDescription>Coming next</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {["Xero", "SMACC", "Sage"].map((p) => (
              <div key={p} className="p-3 rounded-md border bg-muted/30 text-center text-muted-foreground">
                {p} <div className="text-[10px] uppercase tracking-wider mt-1">Coming soon</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}