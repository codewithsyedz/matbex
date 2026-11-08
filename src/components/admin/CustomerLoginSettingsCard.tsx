import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2, MessageSquare, RefreshCw, Save, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const KEY_FROM = "customer_otp_from_number";
const KEY_JWT = "customer_jwt_secret";
const KEY_PROVIDER = "sms_provider";
const KEY_UNIFONIC = "unifonic_settings";
const KEY_TWILIO = "twilio_settings";

function randomSecret(bytes = 48): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function CustomerLoginSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [primary, setPrimary] = useState<"twilio" | "unifonic">("unifonic");
  const [secondary, setSecondary] = useState<"none" | "twilio" | "unifonic">("twilio");
  const [fromNumber, setFromNumber] = useState("");
  const [jwtSecret, setJwtSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [unifonicAppSid, setUnifonicAppSid] = useState("");
  const [unifonicSenderId, setUnifonicSenderId] = useState("");
  const [showAppSid, setShowAppSid] = useState(false);
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [showTwilioSid, setShowTwilioSid] = useState(false);
  const [showTwilioToken, setShowTwilioToken] = useState(false);
  const [twilioEnabled, setTwilioEnabled] = useState(true);
  const [unifonicEnabled, setUnifonicEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_settings" as any)
      .select("key, value")
      .in("key", [KEY_FROM, KEY_JWT, KEY_PROVIDER, KEY_UNIFONIC, KEY_TWILIO]);
    if (error) {
      toast.error(error.message);
    } else if (data) {
      for (const row of data as any[]) {
        if (row.key === KEY_FROM) setFromNumber(row.value?.number ?? "");
        if (row.key === KEY_JWT) setJwtSecret(row.value?.secret ?? "");
        if (row.key === KEY_PROVIDER) {
          // Backward compatible: old shape { provider } maps to primary.
          setPrimary((row.value?.primary ?? row.value?.provider ?? "unifonic") as any);
          setSecondary((row.value?.secondary ?? "none") as any);
          if (typeof row.value?.twilio_enabled === "boolean") setTwilioEnabled(row.value.twilio_enabled);
          if (typeof row.value?.unifonic_enabled === "boolean") setUnifonicEnabled(row.value.unifonic_enabled);
        }
        if (row.key === KEY_UNIFONIC) {
          setUnifonicAppSid(row.value?.app_sid ?? "");
          setUnifonicSenderId(row.value?.sender_id ?? "");
        }
        if (row.key === KEY_TWILIO) {
          setTwilioAccountSid(row.value?.account_sid ?? "");
          setTwilioAuthToken(row.value?.auth_token ?? "");
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const upsert = async (key: string, value: object, is_secret = false) => {
    const { data: u } = await supabase.auth.getUser();
    return supabase
      .from("platform_settings" as any)
      .upsert(
        { key, value, is_secret, updated_by: u.user?.id ?? null },
        { onConflict: "key" },
      );
  };

  const handleSave = async () => {
    if (!twilioEnabled && !unifonicEnabled) {
      toast.error("At least one SMS provider must be enabled");
      return;
    }
    // Derive primary/secondary from enabled flags
    let derivedPrimary = primary;
    let derivedSecondary: typeof secondary = secondary;
    if (twilioEnabled && !unifonicEnabled) {
      derivedPrimary = "twilio";
      derivedSecondary = "none";
    } else if (unifonicEnabled && !twilioEnabled) {
      derivedPrimary = "unifonic";
      derivedSecondary = "none";
    }
    if (derivedSecondary !== "none" && derivedPrimary === (derivedSecondary as string)) {
      toast.error("Primary and secondary providers must be different");
      return;
    }
    const used = new Set<string>();
    if (twilioEnabled) used.add("twilio");
    if (unifonicEnabled) used.add("unifonic");
    if (used.has("twilio") && !/^\+[1-9][0-9]{6,14}$/.test(fromNumber.trim())) {
      toast.error("Twilio From number must be E.164 (e.g. +14155551234)");
      return;
    }
    if (used.has("twilio")) {
      if (!/^AC[a-zA-Z0-9]{32}$/.test(twilioAccountSid.trim())) {
        toast.error("Twilio Account SID must start with 'AC' and be 34 characters");
        return;
      }
      if (twilioAuthToken.trim().length < 16) {
        toast.error("Twilio Auth Token is required");
        return;
      }
    }
    if (used.has("unifonic")) {
      if (!unifonicAppSid.trim()) {
        toast.error("Unifonic AppSid is required");
        return;
      }
      if (unifonicSenderId && unifonicSenderId.length > 11) {
        toast.error("Unifonic Sender ID must be 11 characters or less");
        return;
      }
    }
    setSaving(true);
    let secret = jwtSecret.trim();
    if (!secret || secret.length < 32) {
      secret = randomSecret();
      setJwtSecret(secret);
    }
    const ops = [
      upsert(KEY_PROVIDER, {
        primary: derivedPrimary,
        secondary: derivedSecondary,
        twilio_enabled: twilioEnabled,
        unifonic_enabled: unifonicEnabled,
      }),
      upsert(KEY_JWT, { secret }, true),
    ];
    if (twilioEnabled) {
      ops.push(
      upsert(KEY_FROM, { number: fromNumber.trim() }),
      upsert(
        KEY_TWILIO,
        { account_sid: twilioAccountSid.trim(), auth_token: twilioAuthToken.trim() },
        true,
      ),
      );
    }
    if (unifonicEnabled) {
      ops.push(
        upsert(
        KEY_UNIFONIC,
        { app_sid: unifonicAppSid.trim(), sender_id: unifonicSenderId.trim() || null },
        true,
      ),
      );
    }
    const results = await Promise.all(ops);
    setSaving(false);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toast.error(firstErr.message ?? "Save failed");
    } else {
      toast.success("Customer login settings saved");
    }
  };

  const handleRegenerate = async () => {
    const secret = randomSecret();
    setJwtSecret(secret);
    const { error } = await upsert(KEY_JWT, { secret }, true);
    if (error) toast.error(error.message);
    else toast.success("Signing secret regenerated — existing customer sessions invalidated");
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Customer Login (Phone OTP)</CardTitle>
        </div>
        <CardDescription>
          SMS sender number and signing secret used for global Matbex customer accounts (storefront sign-in & order history).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {twilioEnabled && unifonicEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] sm:items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Primary Provider</Label>
                    <Select value={primary} onValueChange={(v) => setPrimary(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unifonic">Unifonic (KSA)</SelectItem>
                        <SelectItem value="twilio">Twilio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground mb-3" />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Secondary (Fallback)</Label>
                    <Select value={secondary} onValueChange={(v) => setSecondary(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="twilio">Twilio</SelectItem>
                        <SelectItem value="unifonic">Unifonic (KSA)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  The primary gateway is tried first. If it fails (network, quota, rejection), the system automatically retries with the secondary.
                </p>
              </>
            )}
            {(!twilioEnabled || !unifonicEnabled) && (twilioEnabled || unifonicEnabled) && (
              <p className="text-xs text-muted-foreground">
                Only <span className="font-medium">{twilioEnabled ? "Twilio" : "Unifonic"}</span> is enabled — all OTPs route through it (no fallback).
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Twilio configuration */}
            <div className={`rounded-md border border-border/40 p-4 space-y-3 ${!twilioEnabled ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Twilio</h4>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {twilioEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch checked={twilioEnabled} onCheckedChange={setTwilioEnabled} />
                </div>
              </div>
              {twilioEnabled && (<>
              <div className="space-y-1.5">
                <Label htmlFor="otp-from" className="text-xs">SMS From Number (E.164)</Label>
                <Input
                  id="otp-from"
                  placeholder="+14155551234"
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Twilio phone number that sends the 6-digit code. Must match a number you own in your Twilio account.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-sid" className="text-xs">Account SID</Label>
                <div className="relative">
                  <Input
                    id="tw-sid"
                    type={showTwilioSid ? "text" : "password"}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    className="pr-9 font-mono text-xs"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwilioSid((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showTwilioSid ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Found in Twilio Console → Account Info. Starts with "AC".
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-token" className="text-xs">Auth Token</Label>
                <div className="relative">
                  <Input
                    id="tw-token"
                    type={showTwilioToken ? "text" : "password"}
                    placeholder="••••••••••••••••••••••••••••••••"
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    className="pr-9 font-mono text-xs"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwilioToken((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showTwilioToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Found in Twilio Console → Account Info. Used to authenticate SMS sends.
                </p>
              </div>
              </>)}
            </div>

            {/* Unifonic configuration */}
            <div className={`rounded-md border border-border/40 p-4 space-y-3 ${!unifonicEnabled ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Unifonic</h4>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {unifonicEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch checked={unifonicEnabled} onCheckedChange={setUnifonicEnabled} />
                </div>
              </div>
              {unifonicEnabled && (<>
              <div className="space-y-1.5">
                <Label htmlFor="uni-appsid" className="text-xs">Unifonic AppSid</Label>
                <div className="relative">
                  <Input
                    id="uni-appsid"
                    type={showAppSid ? "text" : "password"}
                    placeholder="e.g. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={unifonicAppSid}
                    onChange={(e) => setUnifonicAppSid(e.target.value)}
                    className="pr-9 font-mono text-xs"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppSid((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showAppSid ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Found in Unifonic Console → Apps. Required to authenticate SMS sends.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uni-sender" className="text-xs">Sender ID (optional)</Label>
                <Input
                  id="uni-sender"
                  placeholder="Matbex"
                  maxLength={11}
                  value={unifonicSenderId}
                  onChange={(e) => setUnifonicSenderId(e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Up to 11 alphanumeric characters. Must be approved in your Unifonic account.
                </p>
              </div>
              </>)}
            </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="otp-secret" className="text-xs">JWT Signing Secret</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="otp-secret"
                    type={showSecret ? "text" : "password"}
                    placeholder="Auto-generated on save"
                    value={jwtSecret}
                    onChange={(e) => setJwtSecret(e.target.value)}
                    className="pr-9 font-mono text-xs"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button type="button" variant="outline" onClick={handleRegenerate} title="Regenerate">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used to sign customer session tokens. Regenerating invalidates all existing customer logins.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save settings
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}