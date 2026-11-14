import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquareText, RotateCcw, Save, Eye } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type TemplateRow = {
  id: string;
  restaurant_id: string;
  template_key: string;
  channel: string;
  body: string;
  enabled: boolean;
};

type TemplateKey = "daily_summary";

const DEFAULT_BODIES: Record<TemplateKey, string> = {
  daily_summary: [
    `*{{restaurant_name}}* - Daily P&L`,
    `_{{date}}_`,
    ``,
    `Revenue: {{revenue}}  {{revenue_delta}}`,
    `{{cogs_label}}COGS: {{cogs}} ({{cogs_pct}})`,
    `Labor (allocated): {{labor}}`,
    `Overhead (allocated): {{overhead}}`,
    `Other expenses: {{expenses}}`,
    `Net Profit: {{profit}}  {{profit_delta}}`,
    `Cash variance: {{variance}}`,
    `{{shift_status_line}}`,
    `{{est_note}}`,
    ``,
    `View breakdown → {{summary_link}}`,
    `Shifts & cash → {{shifts_link}}`,
    ``,
    `_Matbex · reply STOP to unsubscribe_`,
  ].join("\n"),
};

const VARIABLES: Array<{ key: string; description: string }> = [
  { key: "restaurant_name", description: "Restaurant display name" },
  { key: "date", description: "Riyadh local date (Mon, 5 May)" },
  { key: "revenue", description: "Net sales for the day" },
  { key: "revenue_delta", description: "▲/▼ vs yesterday" },
  { key: "cogs", description: "Total COGS amount" },
  { key: "cogs_pct", description: "COGS as % of revenue" },
  { key: "cogs_label", description: "'Est. ' when COGS is fallback (else empty)" },
  { key: "labor", description: "Allocated daily labor" },
  { key: "overhead", description: "Allocated daily overhead" },
  { key: "expenses", description: "Other approved expenses" },
  { key: "profit", description: "Net profit" },
  { key: "profit_delta", description: "▲/▼ vs yesterday" },
  { key: "variance", description: "Cash variance (e.g. +SAR 45 / balanced)" },
  { key: "open_shifts", description: "Number of still-open shifts" },
  { key: "shift_status_line", description: "Pre-formatted '⚠ N open' / '✓ All closed'" },
  { key: "est_note", description: "Italic note when COGS is estimated (else empty)" },
  { key: "summary_link", description: "Auto-login link to /cockpit/summary/{ymd}" },
  { key: "shifts_link", description: "Auto-login link to shifts section" },
];

const TEMPLATE_TABS: Array<{ key: TemplateKey; label: string; channel: string; description: string }> = [
  {
    key: "daily_summary",
    label: "Daily WhatsApp summary",
    channel: "whatsapp",
    description:
      "Sent every night at the configured cutoff. Variables in {{double braces}} are replaced before delivery.",
  },
];

export function NotificationTemplatesCard() {
  const { restaurant, isOwner, isManager } = useAuth();
  const canEdit = !!(isOwner || isManager);

  if (!restaurant?.id) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" />
          Message templates
        </CardTitle>
        <CardDescription>
          Customize the wording of WhatsApp/SMS notifications. Use{" "}
          <code className="text-xs font-mono">{"{{variable}}"}</code> placeholders - anything unknown
          renders as an empty string.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={TEMPLATE_TABS[0].key} className="w-full">
          <TabsList>
            {TEMPLATE_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TEMPLATE_TABS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              <TemplateEditor
                restaurantId={restaurant.id}
                templateKey={t.key}
                channel={t.channel}
                description={t.description}
                canEdit={canEdit}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function TemplateEditor({
  restaurantId,
  templateKey,
  channel,
  description,
  canEdit,
}: {
  restaurantId: string;
  templateKey: TemplateKey;
  channel: string;
  description: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const queryKey = ["notification-template", restaurantId, templateKey, channel];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<TemplateRow | null> => {
      const { data, error } = await db
        .from("notification_templates")
        .select("id, restaurant_id, template_key, channel, body, enabled")
        .eq("restaurant_id", restaurantId)
        .eq("template_key", templateKey)
        .eq("channel", channel)
        .maybeSingle();
      if (error) throw error;
      return (data as TemplateRow) ?? null;
    },
  });

  const defaultBody = DEFAULT_BODIES[templateKey];
  const [body, setBody] = useState<string>(defaultBody);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (data) {
      setBody(data.body);
      setEnabled(data.enabled);
    } else {
      setBody(defaultBody);
      setEnabled(true);
    }
  }, [data, defaultBody]);

  const dirty = useMemo(() => {
    if (!data) return body !== defaultBody || enabled !== true;
    return body !== data.body || enabled !== data.enabled;
  }, [body, enabled, data, defaultBody]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        restaurant_id: restaurantId,
        template_key: templateKey,
        channel,
        body,
        enabled,
      };
      const { error } = await db
        .from("notification_templates")
        .upsert(payload, { onConflict: "restaurant_id,template_key,channel" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template saved");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const { error } = await db
        .from("notification_templates")
        .delete()
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reverted to default");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reset failed"),
  });

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      // Send a yesterday-dated preview through the same edge function so we
      // get the real rendered output (variables resolved against actual data).
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ymd = d.toISOString().slice(0, 10);
      // Temporarily save the in-progress body if dirty so preview reflects it.
      if (dirty) {
        await db
          .from("notification_templates")
          .upsert(
            { restaurant_id: restaurantId, template_key: templateKey, channel, body, enabled },
            { onConflict: "restaurant_id,template_key,channel" },
          );
        qc.invalidateQueries({ queryKey });
      }
      const { data: res, error } = await db.functions.invoke("send-daily-whatsapp-summary", {
        body: { restaurant_id: restaurantId, date: ymd, preview: true },
      });
      if (error) throw error;
      setPreview((res as { message?: string })?.message ?? "(no message)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="flex items-center gap-3">
        <Switch
          id={`tpl-enabled-${templateKey}`}
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canEdit}
        />
        <Label htmlFor={`tpl-enabled-${templateKey}`} className="text-sm">
          {enabled ? "Custom template active" : "Disabled - falls back to system default"}
        </Label>
        {data ? (
          <Badge variant="outline" className="ml-auto">Custom</Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto">Default</Badge>
        )}
      </div>

      <div>
        <Label htmlFor={`tpl-body-${templateKey}`} className="text-xs text-muted-foreground">
          Message body ({channel})
        </Label>
        <Textarea
          id={`tpl-body-${templateKey}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          disabled={!canEdit}
          className="font-mono text-xs leading-relaxed mt-1"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          WhatsApp formatting: <code>*bold*</code>, <code>_italic_</code>, <code>~strike~</code>,
          <code className="ml-1">```mono```</code>.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-medium mb-2">Available variables</p>
        <ScrollArea className="max-h-[160px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
            {VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                disabled={!canEdit}
                onClick={() => setBody((b) => `${b}{{${v.key}}}`)}
                className="text-left text-[11px] flex items-baseline gap-2 hover:bg-background rounded px-1 py-0.5 disabled:cursor-not-allowed"
                title={`Insert {{${v.key}}}`}
              >
                <code className="font-mono text-primary shrink-0">{`{{${v.key}}}`}</code>
                <span className="text-muted-foreground truncate">{v.description}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={!canEdit || !dirty || save.isPending}>
          {save.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save template
        </Button>
        <Button variant="outline" onClick={runPreview} disabled={previewLoading}>
          {previewLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Eye className="h-4 w-4 mr-2" />
          )}
          Preview with yesterday's data
        </Button>
        {data && (
          <Button
            variant="ghost"
            onClick={() => reset.mutate()}
            disabled={!canEdit || reset.isPending}
            className="text-muted-foreground"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Revert to default
          </Button>
        )}
      </div>

      {preview && (
        <Alert>
          <AlertDescription>
            <p className="text-xs font-medium mb-2">Rendered preview</p>
            <ScrollArea className="max-h-[320px]">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{preview}</pre>
            </ScrollArea>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}