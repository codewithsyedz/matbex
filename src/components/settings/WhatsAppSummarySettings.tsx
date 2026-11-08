import { useEffect, useState } from "react";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWhatsAppSubscription } from "@/hooks/useWhatsAppSubscription";
import { normalizePhone, formatPhoneDisplay } from "@/lib/phoneUtils";

export function WhatsAppSummarySettings() {
  const { subscription, isLoading, upsert, remove, sendTest } = useWhatsAppSubscription();
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (subscription) {
      setPhone(subscription.phone_e164);
      setEnabled(subscription.enabled);
    }
  }, [subscription]);

  const parsed = normalizePhone(phone, "SA");
  const valid = parsed.error === null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-success/10 text-success">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">WhatsApp daily P&L summary</CardTitle>
              <CardDescription className="text-xs">
                Get today's revenue, profit, and alerts delivered at 11 PM Riyadh time
              </CardDescription>
            </div>
          </div>
          {subscription?.enabled && <Badge variant="secondary">Active</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wa-phone">WhatsApp number (international format)</Label>
          <Input
            id="wa-phone"
            type="tel"
            placeholder="+966555123456 or 0555123456"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\s/g, ""))}
            onBlur={() => {
              if (parsed.error === null) setPhone(parsed.value);
            }}
            disabled={isLoading}
            className={parsed.error ? "border-destructive" : ""}
          />
          {phone && (
            <div className="flex items-center gap-2 min-h-[18px]">
              {parsed.error ? (
                <p className="text-xs text-destructive">{parsed.error}</p>
              ) : (
                <p className="text-xs text-emerald-600">
                  {parsed.formatted ? "Formatted" : "Valid"}: {formatPhoneDisplay(parsed.value)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Enabled</p>
            <p className="text-xs text-muted-foreground">Toggle off to pause without losing your number</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => upsert.mutate({ phone_e164: parsed.value, enabled })}
            disabled={!valid || upsert.isPending}
          >
            {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => sendTest.mutate()}
            disabled={!subscription?.enabled || sendTest.isPending}
          >
            {sendTest.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send test
          </Button>
          {subscription && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          )}
        </div>

        {subscription?.last_sent_at && (
          <p className="text-xs text-muted-foreground">
            Last sent: {new Date(subscription.last_sent_at).toLocaleString()}
          </p>
        )}

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Setup required</p>
          <p>
            Matbex uses Twilio WhatsApp. To start receiving messages on a brand-new number, first
            join the sandbox by sending the join code from Twilio Console to your registered sender
            number. For production traffic, register an approved WhatsApp Business sender in Twilio.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}