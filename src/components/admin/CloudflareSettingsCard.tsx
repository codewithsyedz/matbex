import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Cloud, Eye, EyeOff, Loader2, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const KEY = "cloudflare";
const MASK = "••••••••••••";

interface CfSettings {
  api_token: string;
  zone_id: string;
  cname_target: string;
}

const empty: CfSettings = { api_token: "", zone_id: "", cname_target: "cname.matbex.com" };

export function CloudflareSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [values, setValues] = useState<CfSettings>(empty);
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_settings" as any)
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      toast.error(error.message);
    }
    const v = ((data as any)?.value ?? {}) as Partial<CfSettings>;
    setHasToken(!!v.api_token);
    setValues({
      api_token: v.api_token ? MASK : "",
      zone_id: v.zone_id ?? "",
      cname_target: v.cname_target ?? "cname.matbex.com",
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    // Don't overwrite stored token if user left the mask in place
    const payload: Partial<CfSettings> = {
      zone_id: values.zone_id.trim(),
      cname_target: values.cname_target.trim() || "cname.matbex.com",
    };
    if (values.api_token && values.api_token !== MASK) {
      payload.api_token = values.api_token.trim();
    }

    // Merge with existing
    const { data: existing } = await supabase
      .from("platform_settings" as any)
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const merged = { ...((existing as any)?.value ?? {}), ...payload };

    const { error } = await supabase
      .from("platform_settings" as any)
      .upsert({ key: KEY, value: merged, is_secret: true, description: "Cloudflare API token & zone for custom-domain SSL automation" }, { onConflict: "key" });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cloudflare settings saved");
    await load();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-cloudflare-connection");
      if (error) {
        setTestResult({ ok: false, message: error.message });
        return;
      }
      setTestResult({ ok: !!data?.ok, message: data?.message ?? "Unknown response" });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-base font-medium">Cloudflare (Custom Domains)</CardTitle>
          </div>
          {hasToken ? (
            <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
            </Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
        <CardDescription>
          API token + zone ID used to auto-provision SSL when an Enterprise tenant verifies a custom domain.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cf_zone">Zone ID</Label>
                <Input
                  id="cf_zone"
                  value={values.zone_id}
                  onChange={(e) => setValues((v) => ({ ...v, zone_id: e.target.value }))}
                  placeholder="e.g. 023e105f4ecef8ad9ca31a8372d0c353"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Cloudflare dashboard → matbex.com → API → Zone ID
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cf_cname">CNAME Target</Label>
                <Input
                  id="cf_cname"
                  value={values.cname_target}
                  onChange={(e) => setValues((v) => ({ ...v, cname_target: e.target.value }))}
                  placeholder="cname.matbex.com"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Hostname tenants point their CNAME records to.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf_token">API Token</Label>
              <div className="relative">
                <Input
                  id="cf_token"
                  type={showToken ? "text" : "password"}
                  value={values.api_token}
                  onChange={(e) => setValues((v) => ({ ...v, api_token: e.target.value }))}
                  placeholder={hasToken ? MASK : "Cloudflare API token"}
                  className="pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Required permissions: <code className="text-[10px]">Zone › SSL and Certificates › Edit</code> on the matbex.com zone.
              </p>
            </div>

            {testResult && (
              <Alert variant={testResult.ok ? "default" : "destructive"}>
                {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || !hasToken}>
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}