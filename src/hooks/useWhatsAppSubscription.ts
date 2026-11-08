import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface WhatsAppSubscription {
  id: string;
  restaurant_id: string;
  user_id: string;
  phone_e164: string;
  enabled: boolean;
  last_sent_at: string | null;
  last_sent_ymd: string | null;
}

export function useWhatsAppSubscription() {
  const { user, restaurant } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["whatsapp-subscription", user?.id, restaurant?.id],
    enabled: !!user?.id && !!restaurant?.id,
    queryFn: async (): Promise<WhatsAppSubscription | null> => {
      const { data, error } = await supabase
        .from("owner_whatsapp_subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("restaurant_id", restaurant!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as WhatsAppSubscription | null) ?? null;
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: { phone_e164: string; enabled: boolean }) => {
      if (!user?.id || !restaurant?.id) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("owner_whatsapp_subscriptions")
        .upsert(
          {
            user_id: user.id,
            restaurant_id: restaurant.id,
            phone_e164: input.phone_e164,
            enabled: input.enabled,
          },
          { onConflict: "restaurant_id,user_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-subscription"] });
      toast.success("WhatsApp summary preferences saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!user?.id || !restaurant?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("owner_whatsapp_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-subscription"] });
      toast.success("WhatsApp summary disabled");
    },
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      if (!user?.id || !restaurant?.id) throw new Error("Not authenticated");
      const { data, error } = await supabase.functions.invoke("send-daily-whatsapp-summary", {
        body: { restaurant_id: restaurant.id, user_id: user.id, test: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Test message sent - check your WhatsApp"),
    onError: (e: any) => toast.error(e?.message ?? "Failed to send test"),
  });

  const preview = useMutation({
    mutationFn: async (input: { date: string }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { data, error } = await supabase.functions.invoke("send-daily-whatsapp-summary", {
        body: { restaurant_id: restaurant.id, date: input.date, preview: true },
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        ymd: string;
        message: string;
        today: any;
        yesterday: any;
      };
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to load preview"),
  });

  const cutoffCheck = useMutation({
    mutationFn: async (input: { atUtc: string }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { data, error } = await supabase.functions.invoke("send-daily-whatsapp-summary", {
        body: { restaurant_id: restaurant.id, cutoffCheck: true, atUtc: input.atUtc },
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        atUtc: string;
        atRiyadh: string;
        resolvedYmd: string;
        window: { startUTC: string; endExclusiveUTC: string };
        counts: { sales: number; expenses: number; shifts: number };
      };
    },
  });

  const resend = useMutation({
    mutationFn: async (input: { date: string }) => {
      if (!user?.id || !restaurant?.id) throw new Error("Not authenticated");
      const { data, error } = await supabase.functions.invoke("send-daily-whatsapp-summary", {
        body: {
          restaurant_id: restaurant.id,
          user_id: user.id,
          date: input.date,
          // `test: true` bypasses the once-per-day idempotency guard so we can
          // re-send historical summaries after late COGS approvals.
          test: true,
        },
      });
      if (error) throw error;
      return data as { ok: boolean; count: number; results: Array<{ sub: string; ok?: boolean; sid?: string; error?: string }> };
    },
    onSuccess: (data) => {
      const r = data?.results?.[0];
      if (r?.ok) toast.success(`WhatsApp summary re-sent (SID ${r.sid ?? "-"})`);
      else toast.error(r?.error ?? "Re-send failed");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Re-send failed"),
  });

  return { subscription: query.data, isLoading: query.isLoading, upsert, remove, sendTest, preview, cutoffCheck, resend };
}