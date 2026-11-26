import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2, KeyRound, Save } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

interface Props {
  tenantId?: string;
}

type FormState = {
  account_sid: string;
  auth_token: string;
  api_key_sid: string;
  api_key_secret: string;
  whatsapp_from: string;
  messaging_service_sid: string;
  status_callback_url: string;
};

const EMPTY: FormState = {
  account_sid: "",
  auth_token: "",
  api_key_sid: "",
  api_key_secret: "",
  whatsapp_from: "",
  messaging_service_sid: "",
  status_callback_url: "",
};

export function TwilioCredentialsForm({ tenantId: tenantIdProp }: Props) {
  const [tenantId, setTenantId] = useState<string | null>(tenantIdProp ?? null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tenantIdProp) {
      setTenantId(tenantIdProp);
      return;
    }
    (async () => {
      const { data: u } = await db.auth.getUser();
      if (!u.user) return;
      const { data } = await db
        .from("profiles")
        .select("tenant_id")
        .eq("id", u.user.id)
        .maybeSingle();
      if (data?.tenant_id) setTenantId(data.tenant_id);
    })();
  }, [tenantIdProp]);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await db
        .from("twilio_credentials" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (cancelled) return;
      if (error && error.code !== "PGRST116") {
        toast.error(error.message);
      }
      if (data) {
        setForm({
          account_sid: (data as any).account_sid ?? "",
          auth_token: (data as any).auth_token ?? "",
          api_key_sid: (data as any).api_key_sid ?? "",
          api_key_secret: (data as any).api_key_secret ?? "",
          whatsapp_from: (data as any).whatsapp_from ?? "",
          messaging_service_sid: (data as any).messaging_service_sid ?? "",
          status_callback_url: (data as any).status_callback_url ?? "",
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleSave = async () => {
    setSaving(true);
    const { data: u } = await db.auth.getUser();
    const payload = {
      tenant_id: tenantId,
      ...form,
      updated_by: u.user?.id ?? null,
    };
    const { error } = await db
      .from("twilio_credentials" as any)
      .upsert(payload, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Twilio credentials saved");
  };

  const field = (
    key: keyof FormState,
    label: string,
    placeholder: string,
    secret = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`twilio-${key}`} className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          id={`twilio-${key}`}
          type={secret && !reveal[key] ? "password" : "text"}
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className={secret ? "pr-9 font-mono text-xs" : "font-mono text-xs"}
          autoComplete="off"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => ({ ...r, [key]: !r[key] }))}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {reveal[key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Twilio credentials</CardTitle>
            <CardDescription className="text-xs">
              Stored per-tenant. Used as a fallback when workspace connector is not configured.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!tenantId || loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {field("account_sid", "Account SID", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}
              {field("auth_token", "Auth Token", "••••••••••••••••", true)}
              {field("api_key_sid", "API Key SID (optional)", "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}
              {field("api_key_secret", "API Key Secret (optional)", "••••••••••••••••", true)}
              {field("whatsapp_from", "WhatsApp From", "whatsapp:+9665XXXXXXXX")}
              {field("messaging_service_sid", "Messaging Service SID (optional)", "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}
            </div>
            {field("status_callback_url", "Status Callback URL (optional)", "https://…/functions/v1/twilio-status-webhook")}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save credentials
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}