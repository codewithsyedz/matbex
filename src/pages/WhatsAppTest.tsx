import { useState } from "react";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function WhatsAppTest() {
  const [from, setFrom] = useState("+14155238886"); // Twilio sandbox
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Hello from Matbex 👋");
  const [contentSid, setContentSid] = useState("");
  const [variables, setVariables] = useState('{"1":"Matbex"}');
  const [mode, setMode] = useState<"freeform" | "template">("freeform");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const send = async () => {
    setLoading(true);
    setResult(null);
    try {
      let contentVariables: unknown = undefined;
      if (mode === "template" && variables.trim()) {
        try {
          contentVariables = JSON.parse(variables);
        } catch {
          toast.error("Variables must be valid JSON");
          setLoading(false);
          return;
        }
      }
      const { data, error } = await db.functions.invoke("send-whatsapp", {
        body: { to, from, mode, body, contentSid, contentVariables },
      });
      if (error) throw error;
      setResult(data);
      if ((data as any)?.ok) toast.success(`Sent: ${(data as any).sid}`);
      else toast.error("Failed");
    } catch (e: any) {
      setResult({ error: e?.message ?? String(e) });
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Test (Twilio)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From (E.164)</Label>
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="+14155238886" />
              <p className="mt-1 text-xs text-muted-foreground">Twilio sandbox: +14155238886</p>
            </div>
            <div>
              <Label>To (E.164)</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+9665XXXXXXXX" />
            </div>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList>
              <TabsTrigger value="freeform">Freeform</TabsTrigger>
              <TabsTrigger value="template">Template (ContentSid)</TabsTrigger>
            </TabsList>
            <TabsContent value="freeform" className="space-y-2">
              <Label>Message body</Label>
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Freeform only works inside the 24h customer service window or with the Twilio Sandbox after joining.
              </p>
            </TabsContent>
            <TabsContent value="template" className="space-y-2">
              <Label>Content SID (HX...)</Label>
              <Input value={contentSid} onChange={(e) => setContentSid(e.target.value)} placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              <Label>Variables (JSON)</Label>
              <Textarea rows={3} value={variables} onChange={(e) => setVariables(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Required for new conversations / outside 24h window. Create templates in Twilio Console → Content Template Builder.
              </p>
            </TabsContent>
          </Tabs>

          <Button onClick={send} disabled={loading || !to || !from} className="w-full">
            {loading ? "Sending..." : "Send WhatsApp"}
          </Button>

          {result !== null && (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}