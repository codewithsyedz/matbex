import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone, Loader2, Power } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Channel = "whatsapp" | "sms";

interface ChannelRow {
  id: string;
  restaurant_id: string;
  channel: Channel;
  enabled: boolean;
  updated_at: string;
}

const CHANNELS: Array<{
  key: Channel;
  label: string;
  description: string;
  icon: typeof MessageSquare;
}> = [
  {
    key: "whatsapp",
    label: "WhatsApp notifications",
    description: "Daily P&L summary, late-COGS reminders, and shift alerts via WhatsApp.",
    icon: MessageSquare,
  },
  {
    key: "sms",
    label: "SMS alerts",
    description: "Critical alerts (high variance, failed login, fraud) delivered via SMS.",
    icon: Phone,
  },
];

/**
 * Per-restaurant master switches for outbound notification channels.
 * Disabling a channel here overrides per-user subscriptions: no message
 * will be sent on that channel for this restaurant.
 *
 * Default is ENABLED when no row exists - see `isChannelEnabled` in the
 * `send-daily-whatsapp-summary` edge function.
 */
export function RestaurantNotificationChannelsCard() {
  const { restaurant, isOwner, isManager } = useAuth();
  const qc = useQueryClient();
  const canEdit = !!(isOwner || isManager);

  const { data, isLoading } = useQuery({
    queryKey: ["restaurant-notif-channels", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async (): Promise<ChannelRow[]> => {
      const { data, error } = await supabase
        .from("restaurant_notification_channels")
        .select("id, restaurant_id, channel, enabled, updated_at")
        .eq("restaurant_id", restaurant!.id);
      if (error) throw error;
      return (data ?? []) as ChannelRow[];
    },
  });

  const byChannel = useMemo(() => {
    const map = new Map<Channel, ChannelRow>();
    (data ?? []).forEach((r) => map.set(r.channel, r));
    return map;
  }, [data]);

  const toggle = useMutation({
    mutationFn: async (input: { channel: Channel; enabled: boolean }) => {
      if (!restaurant?.id) throw new Error("No restaurant selected");
      const { error } = await supabase
        .from("restaurant_notification_channels")
        .upsert(
          {
            restaurant_id: restaurant.id,
            channel: input.channel,
            enabled: input.enabled,
          },
          { onConflict: "restaurant_id,channel" },
        );
      if (error) throw error;
    },
    onMutate: async (input) => {
      const key = ["restaurant-notif-channels", restaurant?.id];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChannelRow[]>(key);
      qc.setQueryData<ChannelRow[]>(key, (old) => {
        const next = [...(old ?? [])];
        const idx = next.findIndex((r) => r.channel === input.channel);
        if (idx >= 0) next[idx] = { ...next[idx], enabled: input.enabled };
        else
          next.push({
            id: "optimistic",
            restaurant_id: restaurant!.id,
            channel: input.channel,
            enabled: input.enabled,
            updated_at: new Date().toISOString(),
          });
        return next;
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(["restaurant-notif-channels", restaurant?.id], ctx.prev);
      }
      toast.error(e instanceof Error ? e.message : "Failed to update");
    },
    onSuccess: (_d, input) => {
      toast.success(
        `${input.channel === "whatsapp" ? "WhatsApp" : "SMS"} ${
          input.enabled ? "enabled" : "disabled"
        } for this restaurant`,
      );
      qc.invalidateQueries({ queryKey: ["restaurant-notif-channels", restaurant?.id] });
    },
  });

  if (!restaurant?.id) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Power className="h-4 w-4 text-primary" />
          Notification channels - {restaurant.name}
        </CardTitle>
        <CardDescription>
          Master switches for outbound messages. Disabling a channel here stops every user's
          subscription for this restaurant, regardless of personal settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          CHANNELS.map((c) => {
            const row = byChannel.get(c.key);
            const enabled = row ? row.enabled : true; // default-on
            const Icon = c.icon;
            return (
              <div
                key={c.key}
                className="flex items-start justify-between gap-4 rounded-md border p-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-md shrink-0 ${
                      enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{c.label}</p>
                      {enabled ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-200">
                          On
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Off</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                    {row && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Updated{" "}
                        {new Date(row.updated_at).toLocaleString("en-GB", {
                          timeZone: "Asia/Riyadh",
                          hour12: false,
                        })}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  disabled={!canEdit || toggle.isPending}
                  onCheckedChange={(v) => toggle.mutate({ channel: c.key, enabled: v })}
                />
              </div>
            );
          })
        )}
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground">
            Only owners and managers can change these toggles.
          </p>
        )}
      </CardContent>
    </Card>
  );
}