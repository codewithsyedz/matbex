import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Loader2, CheckCircle2, XCircle, Send, RefreshCw, ExternalLink, AlertTriangle, Copy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizePhone, formatPhoneDisplay } from "@/lib/phoneUtils";
import { useAuth } from "@/contexts/AuthContext";

type StatusResp = {
  ok: true;
  env: {
    lovable_api_key_present: boolean;
    twilio_connector_present: boolean;
    whatsapp_from_present: boolean;
    whatsapp_from_masked: string;
    using_sandbox_default: boolean;
  };
  ping: { ok: boolean; error?: string; account_sid_last4?: string };
};

export function TwilioSettings() {
  const qc = useQueryClient();
  const [testTo, setTestTo] = useState("");
  const { hasRole, session, loading } = useAuth();
  const isOwner = hasRole("owner");
  const accessToken = session?.access_token;

  const status = useQuery({
    queryKey: ["twilio-config-status"],
    enabled: !loading && isOwner && !!accessToken,
    retry: false,
    queryFn: async (): Promise<StatusResp> => {
      if (!accessToken) {
        throw new Error("No active session. Please sign in again.");
      }

      const { data, error } = await supabase.functions.invoke("twilio-config-check", {
        body: { action: "status" },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) throw error;
      return data as StatusResp;
    },
    staleTime: 60_000,
  });

  const sendTest = useMutation({
    mutationFn: async (to: string) => {
      if (!accessToken) {
        throw new Error("No active session. Please sign in again.");
      }

      const { data, error } = await supabase.functions.invoke("twilio-config-check", {
        body: { action: "test", to },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) throw error;
      return data as { ok: boolean; sid?: string; status?: string; error?: string };
    },
    onSuccess: (res) => {
      if (res.ok) toast.success(`Test sent (sid: ${res.sid?.slice(-8) ?? "-"})`);
      else toast.error(res.error ?? "Twilio test failed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Twilio test failed"),
  });

  const env = status.data?.env;
  const ping = status.data?.ping;
  const allHealthy = env?.twilio_connector_present && ping?.ok;
  const phone = normalizePhone(testTo, "SA");
  const validTo = phone.error === null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-success/10 text-success">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Twilio configuration</CardTitle>
              <CardDescription className="text-xs">
                WhatsApp & SMS provider used for daily summaries and alerts
              </CardDescription>
            </div>
          </div>
          {status.isLoading ? (
            <Badge variant="secondary">Checking…</Badge>
          ) : allHealthy ? (
            <Badge variant="secondary" className="bg-success/10 text-success">Connected</Badge>
          ) : (
            <Badge variant="destructive">Not ready</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connector */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Twilio connector (API Key)</p>
              <p className="text-xs text-muted-foreground">
                Managed in <span className="font-medium">Workspace → Connectors → Twilio</span>
              </p>
            </div>
            <StatusPill ok={!!env?.twilio_connector_present} label={env?.twilio_connector_present ? "Linked" : "Missing"} />
          </div>
          {ping?.account_sid_last4 && (
            <p className="text-xs text-muted-foreground">
              Account SID ends in <span className="font-mono">…{ping.account_sid_last4}</span>
            </p>
          )}
          {ping && !ping.ok && env?.twilio_connector_present && (
            <p className="text-xs text-destructive break-all">Ping failed: {ping.error}</p>
          )}
        </div>

        {/* From number */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">WhatsApp sender (From)</p>
              <p className="text-xs text-muted-foreground font-mono">{env?.whatsapp_from_masked ?? "-"}</p>
            </div>
            <StatusPill
              ok={!!env?.whatsapp_from_present}
              label={env?.whatsapp_from_present ? "Set" : "Sandbox default"}
              warn={!env?.whatsapp_from_present}
            />
          </div>
          {env?.using_sandbox_default && (
            <Alert variant="default" className="border-warning/40">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-xs">Using Twilio sandbox sender</AlertTitle>
              <AlertDescription className="text-xs">
                Recipients must first send the join code to <span className="font-mono">+1 415 523 8886</span>.
                For production, register an approved WhatsApp Business sender and set the{" "}
                <span className="font-mono">TWILIO_WHATSAPP_FROM</span> secret (e.g.{" "}
                <span className="font-mono">whatsapp:+9665…</span>).
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Test send */}
        <div className="rounded-md border p-3 space-y-3">
          <div>
            <Label htmlFor="twilio-test-to" className="text-sm">Send a test WhatsApp</Label>
            <p className="text-xs text-muted-foreground">
              Verifies credentials, sender, and delivery end-to-end.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1">
              <Input
                id="twilio-test-to"
                placeholder="+966555123456 or 0555123456"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value.replace(/\s/g, ""))}
                onBlur={() => {
                  const n = normalizePhone(testTo, "SA");
                  if (n.error === null) setTestTo(n.value);
                }}
                className={phone.error ? "border-destructive" : ""}
              />
              {testTo && (
                <div className="flex items-center gap-2">
                  {phone.error ? (
                    <p className="text-xs text-destructive">{phone.error}</p>
                  ) : (
                    <p className="text-xs text-emerald-600">
                      {phone.formatted ? "Formatted" : "Valid"}: {formatPhoneDisplay(phone.value)}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Button
              onClick={() => sendTest.mutate(phone.value)}
              disabled={!!phone.error || !allHealthy || sendTest.isPending}
            >
              {sendTest.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send test
            </Button>
          </div>
        </div>

        {/* Status callback webhook */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Delivery status webhook</p>
              <p className="text-xs text-muted-foreground">
                Paste this URL into Twilio (Messaging service → Integration → Status callback URL)
                so every queued / sent / delivered / read / failed event is written to the audit log.
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              readOnly
              value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-status-webhook`}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-status-webhook`;
                navigator.clipboard.writeText(url);
                toast.success("Webhook URL copied");
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Outbound summaries also pass <span className="font-mono">StatusCallback</span> automatically.
            Set the optional <span className="font-mono">TWILIO_AUTH_TOKEN</span> secret to enforce
            X-Twilio-Signature verification.
          </p>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["twilio-config-status"] });
            }}
            disabled={status.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${status.isFetching ? "animate-spin" : ""}`} />
            Refresh status
          </Button>
          <a
            href="https://console.twilio.com/"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Twilio Console <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Where to change these</p>
          <p>
            • <span className="font-medium">API Key / Account SID</span>: Workspace → Connectors → Twilio (reconnect to rotate)
          </p>
          <p>
            • <span className="font-medium">Sender (TWILIO_WHATSAPP_FROM)</span>: Backend → Secrets
          </p>
          <p>
            • Enable <span className="font-medium">SMS Pumping Protection</span> & restrict{" "}
            <span className="font-medium">Geo Permissions</span> in Twilio before going live.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  if (ok && !warn) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (warn) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive">
      <XCircle className="h-3.5 w-3.5" /> {label}
    </span>
  );
}