import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LinkedLocation {
  external_location_id: string;
  location_name: string | null;
  branch_id: string | null;
  registered_at: string | null;
  is_active: boolean;
}

async function act(body: Record<string, unknown>) {
  const { data, error } = await db.functions.invoke("deliverect-actions", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
    throw new Error(payload?.error || error.message);
  }
  return data;
}

/**
 * Deliverect: one hub for Jahez, HungerStation, Keeta and other delivery apps. Orders arrive in
 * Online Orders; accepting, preparing, ready, completing or cancelling them there is sent back to
 * Deliverect automatically. The menu is sent from here; busy mode pauses delivery orders.
 */
export function DeliverectCard() {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const linked = useQuery({
    queryKey: ["deliverect-locations", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db.from("delivery_platform_locations")
        .select("external_location_id, location_name, branch_id, registered_at, is_active")
        .eq("restaurant_id", restaurant!.id).eq("provider", "deliverect");
      if (error) throw error;
      return (data ?? []) as LinkedLocation[];
    },
  });
  const pending = useQuery({
    queryKey: ["deliverect-outbox", restaurant?.id],
    enabled: !!restaurant?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await db.from("delivery_status_outbox")
        .select("id, status_code, attempts, last_error, created_at")
        .eq("restaurant_id", restaurant!.id).is("sent_at", null).order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });

  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      const r = await act(body);
      toast.success(r?.products != null ? `${ok}: ${r.products} products` : ok);
      void qc.invalidateQueries({ queryKey: ["deliverect-locations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deliverect request failed");
    } finally {
      setBusy(null);
    }
  };

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "Branch";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Deliverect (Jahez, HungerStation, Keeta…)</CardTitle>
        <CardDescription>
          Orders from the delivery apps arrive in Online Orders. Accepting, marking ready, completing or cancelling them there
          updates the delivery app automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium">1. In Deliverect, set each location's external location ID to its Matbex branch ID:</p>
          {branches.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-[140px]">{b.name}</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{b.id}</code>
              <Button type="button" size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(b.id); toast.success("Copied"); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">2. Ask Deliverect to link the location to the Matbex POS integration; it appears below once linked.</p>
        </div>

        {linked.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (linked.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">No Deliverect location linked yet.</p>
        ) : (
          <div className="space-y-2">
            {linked.data!.map((l) => (
              <div key={l.external_location_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <span>
                  <b>{l.location_name ?? "Deliverect location"}</b> → {branchName(l.branch_id)}{" "}
                  {l.is_active ? <Badge variant="secondary">Linked</Badge> : <Badge variant="outline">Off</Badge>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => run(`menu-${l.external_location_id}`, { action: "send_menu", location_id: l.external_location_id }, "Menu sent to Deliverect")}>
                    {busy === `menu-${l.external_location_id}` && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Send menu
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => run(`busy-${l.external_location_id}`, { action: "busy", location_id: l.external_location_id, minutes: 30 }, "Delivery orders paused for 30 minutes")}>
                    Pause 30 min
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => run(`resume-${l.external_location_id}`, { action: "resume", location_id: l.external_location_id }, "Taking delivery orders again")}>
                    Resume
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {(pending.data ?? []).some((p: any) => p.attempts > 0) && (
          <div className="rounded-md bg-warning/10 p-2 text-xs">
            Some order updates have not reached Deliverect yet; they are retried automatically.
            {(pending.data ?? []).filter((p: any) => p.last_error).slice(0, 1).map((p: any) => <span key={p.id} className="block text-muted-foreground">Last error: {p.last_error}</span>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
