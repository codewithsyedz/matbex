import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineOrderSettings } from "@/hooks/useOnlineOrders";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { DeliveryFeeTier } from "@/lib/deliveryFee";
import { computeDeliveryFee } from "@/lib/deliveryFee";

export default function OnlineOrderSettings() {
  const { restaurant } = useAuth();
  const { data, save, isLoading } = useOnlineOrderSettings(restaurant?.id);
  const [form, setForm] = useState({
    accepting_orders: true,
    accept_delivery: true,
    accept_pickup: true,
    min_order_amount: 0,
    delivery_fee_flat: 0,
    delivery_radius_km: 10,
    prep_time_minutes: 30,
    storefront_message: "",
    delivery_fee_tiers: [] as DeliveryFeeTier[],
    rider_commission_pct: 0,
  });

  useEffect(() => {
    if (data) {
      setForm({
        accepting_orders: data.accepting_orders ?? true,
        accept_delivery: data.accept_delivery ?? true,
        accept_pickup: data.accept_pickup ?? true,
        min_order_amount: Number(data.min_order_amount ?? 0),
        delivery_fee_flat: Number(data.delivery_fee_flat ?? 0),
        delivery_radius_km: Number(data.delivery_radius_km ?? 10),
        prep_time_minutes: Number(data.prep_time_minutes ?? 30),
        storefront_message: data.storefront_message ?? "",
        delivery_fee_tiers: Array.isArray((data as any).delivery_fee_tiers)
          ? ((data as any).delivery_fee_tiers as DeliveryFeeTier[])
          : [],
        rider_commission_pct: Number((data as any).rider_commission_pct ?? 0),
      });
    }
  }, [data]);

  const onSave = async () => {
    try {
      // Normalize tiers: ensure numeric, sort, drop invalid
      const cleaned = (form.delivery_fee_tiers || [])
        .map((t) => ({
          min_subtotal: Number(t.min_subtotal) || 0,
          max_subtotal:
            t.max_subtotal === null || t.max_subtotal === undefined || (t.max_subtotal as any) === ""
              ? null
              : Number(t.max_subtotal),
          fee: Number(t.fee) || 0,
        }))
        .sort((a, b) => a.min_subtotal - b.min_subtotal);
      await save.mutateAsync({ ...form, delivery_fee_tiers: cleaned });
      toast.success("Settings saved");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    }
  };

  const updateTier = (idx: number, patch: Partial<DeliveryFeeTier>) => {
    setForm((f) => ({
      ...f,
      delivery_fee_tiers: f.delivery_fee_tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  };
  const addTier = () => {
    setForm((f) => {
      const last = f.delivery_fee_tiers[f.delivery_fee_tiers.length - 1];
      const nextMin = last ? Number(last.max_subtotal ?? last.min_subtotal) || 0 : 0;
      return {
        ...f,
        delivery_fee_tiers: [...f.delivery_fee_tiers, { min_subtotal: nextMin, max_subtotal: null, fee: 0 }],
      };
    });
  };
  const removeTier = (idx: number) => {
    setForm((f) => ({ ...f, delivery_fee_tiers: f.delivery_fee_tiers.filter((_, i) => i !== idx) }));
  };

  const publicUrl = restaurant ? `${window.location.origin}/order/${restaurant.id}` : "";

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Online Ordering Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure delivery and pickup for your storefront</p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Accepting orders</Label>
            <p className="text-xs text-muted-foreground">Turn off to temporarily pause</p>
          </div>
          <Switch checked={form.accepting_orders} onCheckedChange={(v) => setForm((f) => ({ ...f, accepting_orders: v }))} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-base">Pickup</Label>
          <Switch checked={form.accept_pickup} onCheckedChange={(v) => setForm((f) => ({ ...f, accept_pickup: v }))} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-base">Delivery</Label>
          <Switch checked={form.accept_delivery} onCheckedChange={(v) => setForm((f) => ({ ...f, accept_delivery: v }))} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Min order amount</Label>
            <Input type="number" min={0} step="0.01" value={form.min_order_amount}
              onChange={(e) => setForm((f) => ({ ...f, min_order_amount: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Prep time (minutes)</Label>
            <Input type="number" min={1} value={form.prep_time_minutes}
              onChange={(e) => setForm((f) => ({ ...f, prep_time_minutes: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Delivery fee</Label>
            <Input type="number" min={0} step="0.01" value={form.delivery_fee_flat}
              onChange={(e) => setForm((f) => ({ ...f, delivery_fee_flat: Number(e.target.value) }))} />
            <p className="text-[11px] text-muted-foreground mt-1">Used when no tiers are defined.</p>
          </div>
          <div>
            <Label>Delivery radius (km)</Label>
            <Input type="number" min={0} step="0.1" value={form.delivery_radius_km}
              onChange={(e) => setForm((f) => ({ ...f, delivery_radius_km: Number(e.target.value) }))} />
          </div>
        </div>
        <div>
          <Label>Storefront message (shown when closed)</Label>
          <Textarea maxLength={500} value={form.storefront_message}
            onChange={(e) => setForm((f) => ({ ...f, storefront_message: e.target.value }))} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-base">Tiered delivery fees</Label>
            <p className="text-xs text-muted-foreground">
              Charge different fees by order size. E.g. orders under 50 pay 15, 50–100 pay 10, 100+ pay 0 (free).
              Leave the upper bound empty for the last tier (no maximum).
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addTier}>
            <Plus className="h-4 w-4 mr-1" /> Add tier
          </Button>
        </div>

        {form.delivery_fee_tiers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No tiers yet — the flat delivery fee above will be used.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground px-1">
              <span>From (subtotal ≥)</span>
              <span>To (&lt;)</span>
              <span>Delivery fee</span>
              <span />
            </div>
            {form.delivery_fee_tiers.map((t, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                <Input
                  type="number" min={0} step="0.01" value={t.min_subtotal}
                  onChange={(e) => updateTier(idx, { min_subtotal: Number(e.target.value) })}
                />
                <Input
                  type="number" min={0} step="0.01"
                  placeholder="∞"
                  value={t.max_subtotal ?? ""}
                  onChange={(e) =>
                    updateTier(idx, { max_subtotal: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
                <Input
                  type="number" min={0} step="0.01" value={t.fee}
                  onChange={(e) => updateTier(idx, { fee: Number(e.target.value) })}
                />
                <Button type="button" size="icon" variant="ghost" onClick={() => removeTier(idx)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Preview</p>
              {[25, 60, 120, 250].map((s) => {
                const fee = computeDeliveryFee(s, form.delivery_fee_tiers, form.delivery_fee_flat);
                return (
                  <div key={s} className="flex justify-between tabular-nums">
                    <span>Subtotal ﷼ {s}</span>
                    <span>Delivery ﷼ {fee.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <div>
          <Label className="text-base">Rider commission</Label>
          <p className="text-xs text-muted-foreground">
            Percentage of the delivery fee paid to the rider, similar to HungerStation / Jahez / Mrsool.
            This is internal — it does <strong>not</strong> increase the customer's total. It's recorded on each delivery order for payout reconciliation.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Commission %</Label>
            <Input
              type="number" min={0} max={100} step="0.1"
              value={form.rider_commission_pct}
              onChange={(e) => setForm((f) => ({ ...f, rider_commission_pct: Number(e.target.value) }))}
            />
          </div>
          <div className="text-xs text-muted-foreground self-end pb-2">
            Example: delivery fee ﷼ 15 × {form.rider_commission_pct || 0}% ={" "}
            <span className="font-medium text-foreground">
              ﷼ {((15 * (Number(form.rider_commission_pct) || 0)) / 100).toFixed(2)}
            </span>{" "}
            to rider.
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <Label className="text-base">Storefront link</Label>
        <div className="flex gap-2 mt-2">
          <Input readOnly value={publicUrl} />
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Copied"); }}>
            Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Share this with customers to take online orders.</p>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
      </div>
    </div>
  );
}