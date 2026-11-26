import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

export function TestConfirmationEmailCard() {
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ from: string; fromName: string; recipient: string } | null>(null);

  useEffect(() => {
    db.auth.getUser().then(({ data }) => {
      if (data.user?.email) setRecipient(data.user.email);
    });
  }, []);

  const handleSend = async () => {
    if (!recipient) {
      toast.error("Please enter a recipient email");
      return;
    }
    setSending(true);
    setLastResult(null);
    try {
      const { data, error } = await db.functions.invoke("send-test-confirmation", {
        body: { recipient },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Send failed");
      setLastResult({ from: data.from, fromName: data.fromName, recipient: data.recipient });
      toast.success(`Test email sent - From: ${data.fromName}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to send test email");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Email Sender Test</CardTitle>
        </div>
        <CardDescription>
          Send a sample confirmation email to verify branding and the From sender name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="test-email-recipient" className="text-sm">Recipient</Label>
          <div className="flex gap-2">
            <Input
              id="test-email-recipient"
              type="email"
              placeholder="you@example.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={sending || !recipient}>
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send test email
                </>
              )}
            </Button>
          </div>
        </div>

        {lastResult && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Test email dispatched
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 pl-6">
              <div><span className="font-medium text-foreground">From name:</span> {lastResult.fromName}</div>
              <div><span className="font-medium text-foreground">Full From:</span> {lastResult.from}</div>
              <div><span className="font-medium text-foreground">Sent to:</span> {lastResult.recipient}</div>
            </div>
            <p className="text-xs text-muted-foreground pl-6 pt-1">
              Open the email in your inbox to confirm the sender displays as <strong>{lastResult.fromName}</strong>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}