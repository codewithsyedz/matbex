import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useLoyaltySettings, useCustomerLoyalty, calcRedemptionValue } from "@/hooks/useLoyalty";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Award, Gift, Settings as SettingsIcon, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export default function Loyalty() {
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const settingsQ = useLoyaltySettings();
  const settings = settingsQ.data;
  const [draft, setDraft] = useState<any>(null);
  const [redeemFor, setRedeemFor] = useState<any | null>(null);

  const customers = useQuery({
    queryKey: ["customers-loyalty", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,phone,email,points_balance,lifetime_points,tier,marketing_opt_in,last_engagement_at")
        .eq("restaurant_id", restaurant!.id)
        .order("points_balance", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const s = draft ?? settings;

  const tierBadge = (tier: string) => {
    const color =
      tier === "gold"
        ? "bg-warning/10 text-warning border-warning/30"
        : tier === "silver"
        ? "bg-muted text-muted-foreground border-border"
        : "bg-primary/10 text-primary border-primary/30";
    return <Badge variant="outline" className={color}>{tier}</Badge>;
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Loyalty Program</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurable points, tiers, and re-engagement.
          </p>
        </div>
        {settings && (
          <div className="flex items-center gap-3">
            <Label htmlFor="enabled" className="text-sm">Enabled</Label>
            <Switch
              id="enabled"
              checked={s?.enabled}
              onCheckedChange={(v) =>
                settingsQ.update.mutate({ enabled: v })
              }
            />
          </div>
        )}
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members"><Award className="w-4 h-4 mr-2" />Members</TabsTrigger>
          <TabsTrigger value="rules"><SettingsIcon className="w-4 h-4 mr-2" />Rules</TabsTrigger>
          <TabsTrigger value="reengagement"><MessageSquare className="w-4 h-4 mr-2" />Re-engagement</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Top members by points</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">Lifetime</TableHead>
                    <TableHead className="text-right">Redemption</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(customers.data ?? []).map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone || c.email || "—"}</div>
                      </TableCell>
                      <TableCell>{tierBadge(c.tier)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(c.points_balance).toFixed(0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{Number(c.lifetime_points).toFixed(0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{format(calcRedemptionValue(c.points_balance, settings))}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setRedeemFor(c)}>
                          <Gift className="w-3.5 h-3.5 mr-1" /> Redeem
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {customers.data && customers.data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No customers yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          {settings && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Earning & Redemption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldNumber
                    label="Points earned per ﷼1 spent"
                    value={s.earn_rate_points_per_currency}
                    onChange={(v) => setDraft({ ...s, earn_rate_points_per_currency: v })}
                  />
                  <FieldNumber
                    label="Points required per redemption unit"
                    value={s.redemption_points_per_unit}
                    onChange={(v) => setDraft({ ...s, redemption_points_per_unit: v })}
                  />
                  <FieldNumber
                    label="Redemption value (﷼ per unit)"
                    value={s.redemption_value_per_unit}
                    onChange={(v) => setDraft({ ...s, redemption_value_per_unit: v })}
                  />
                  <FieldNumber
                    label="Min points to redeem"
                    value={s.min_redeem_points}
                    onChange={(v) => setDraft({ ...s, min_redeem_points: v })}
                  />
                  <FieldNumber
                    label="Max % of order via points"
                    value={s.max_redeem_pct}
                    onChange={(v) => setDraft({ ...s, max_redeem_pct: v })}
                  />
                  <FieldNumber
                    label="Points expire after (months)"
                    value={s.expiry_months}
                    onChange={(v) => setDraft({ ...s, expiry_months: v })}
                  />
                </div>

                <div>
                  <h3 className="font-medium mb-3">Tiers</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldNumber
                      label="Silver threshold (lifetime pts)"
                      value={s.tier_silver_threshold}
                      onChange={(v) => setDraft({ ...s, tier_silver_threshold: v })}
                    />
                    <FieldNumber
                      label="Silver earn multiplier"
                      value={s.tier_silver_multiplier}
                      step={0.05}
                      onChange={(v) => setDraft({ ...s, tier_silver_multiplier: v })}
                    />
                    <FieldNumber
                      label="Gold threshold (lifetime pts)"
                      value={s.tier_gold_threshold}
                      onChange={(v) => setDraft({ ...s, tier_gold_threshold: v })}
                    />
                    <FieldNumber
                      label="Gold earn multiplier"
                      value={s.tier_gold_multiplier}
                      step={0.05}
                      onChange={(v) => setDraft({ ...s, tier_gold_multiplier: v })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDraft(null)} disabled={!draft}>
                    Reset
                  </Button>
                  <Button
                    onClick={() => {
                      if (!draft) return;
                      const { id, restaurant_id, ...patch } = draft;
                      settingsQ.update.mutate(patch, { onSuccess: () => setDraft(null) });
                    }}
                    disabled={!draft || settingsQ.update.isPending}
                  >
                    Save rules
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="reengagement" className="mt-4">
          <ReengagementPanel customers={customers.data ?? []} />
        </TabsContent>
      </Tabs>

      <RedeemDialog
        customer={redeemFor}
        settings={settings}
        onClose={() => setRedeemFor(null)}
      />
    </div>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function RedeemDialog({
  customer,
  settings,
  onClose,
}: {
  customer: any | null;
  settings: any;
  onClose: () => void;
}) {
  const { format } = useCurrency();
  const [points, setPoints] = useState<number>(0);
  const { post } = useCustomerLoyalty(customer?.id);

  if (!customer) return null;
  const value = calcRedemptionValue(points, settings);
  const minOk = points >= (settings?.min_redeem_points ?? 0);
  const balanceOk = points <= customer.points_balance;

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redeem points — {customer.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Balance: <span className="font-medium text-foreground">{Number(customer.points_balance).toFixed(0)} pts</span>
          </div>
          <div>
            <Label>Points to redeem</Label>
            <Input
              type="number"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
              min={0}
              max={customer.points_balance}
            />
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            Value: <span className="font-semibold">{format(value)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!minOk || !balanceOk || value <= 0 || post.isPending}
            onClick={() =>
              post.mutate(
                {
                  customer_id: customer.id,
                  kind: "redeem",
                  points: -Math.abs(points),
                  currency_value: value,
                  note: "Manual redemption",
                },
                {
                  onSuccess: () => {
                    toast.success(`Redeemed ${points} pts → ${format(value)}`);
                    onClose();
                  },
                }
              )
            }
          >
            Redeem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReengagementPanel({ customers }: { customers: any[] }) {
  const { restaurant } = useAuth();
  const dormant = customers.filter((c) => {
    if (!c.marketing_opt_in) return false;
    if (!c.last_engagement_at) return true;
    const days = (Date.now() - new Date(c.last_engagement_at).getTime()) / 86400000;
    return days > 30;
  });

  const sendWhatsApp = (c: any) => {
    if (!c.phone) return toast.error("Customer has no phone");
    const msg = encodeURIComponent(
      `Hi ${c.name}, we miss you at ${restaurant?.name ?? "our restaurant"}. You have ${Number(c.points_balance).toFixed(0)} loyalty points waiting!`
    );
    const phone = c.phone.replace(/[^0-9]/g, "");
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
    supabase
      .from("reengagement_messages" as any)
      .insert({
        restaurant_id: restaurant!.id,
        customer_id: c.id,
        channel: "whatsapp",
        template: "we-miss-you",
        status: "sent",
        sent_at: new Date().toISOString(),
      } as any)
      .then(({ error }) => error && toast.error(error.message));
  };

  const sendEmail = async (c: any) => {
    if (!c.email) return toast.error("Customer has no email");
    const { data, error } = await supabase.functions.invoke("send-loyalty-reengagement", {
      body: { customerId: c.id },
    });
    if (error) return toast.error(error.message);
    if (data && data.sent === false) {
      return toast.error(`${c.email} has opted out of emails`);
    }
    await supabase.from("reengagement_messages" as any).insert({
      restaurant_id: restaurant!.id,
      customer_id: c.id,
      channel: "email",
      template: "loyalty-reengagement",
      status: "sent",
      sent_at: new Date().toISOString(),
    } as any);
    toast.success(`Email sent to ${c.email}`);
  };


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Dormant customers (30+ days)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Last engagement</TableHead>
              <TableHead className="text-right">Reach out</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dormant.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.phone || "—"} · {c.email || "—"}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{Number(c.points_balance).toFixed(0)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {c.last_engagement_at
                    ? new Date(c.last_engagement_at).toLocaleDateString()
                    : "Never"}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => sendWhatsApp(c)} disabled={!c.phone}>
                    WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendEmail(c)} disabled={!c.email}>
                    Email
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {dormant.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No dormant customers — nice!
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}