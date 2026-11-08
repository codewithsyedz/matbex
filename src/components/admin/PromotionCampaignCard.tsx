import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Save, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Campaign {
  id: string;
  name: string;
  badge_label: string;
  headline: string;
  subheadline: string | null;
  badge_label_ar: string | null;
  headline_ar: string | null;
  subheadline_ar: string | null;
  perks_ar: string[];
  max_slots: number;
  claimed_slots: number;
  discount_percent: number;
  locked_price_forever: boolean;
  perks: string[];
  is_active: boolean;
}

export const PromotionCampaignCard = () => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPerk, setNewPerk] = useState("");
  const [newPerkAr, setNewPerkAr] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("promotion_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      toast.error("Failed to load campaign");
    } else if (data) {
      const perks = Array.isArray(data.perks) ? (data.perks as string[]) : [];
      const perks_ar = Array.isArray((data as any).perks_ar) ? ((data as any).perks_ar as string[]) : [];
      setCampaign({ ...data, perks, perks_ar } as Campaign);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!campaign) return;
    setSaving(true);
    const { error } = await supabase
      .from("promotion_campaigns")
      .update({
        name: campaign.name,
        badge_label: campaign.badge_label,
        headline: campaign.headline,
        subheadline: campaign.subheadline,
        badge_label_ar: campaign.badge_label_ar,
        headline_ar: campaign.headline_ar,
        subheadline_ar: campaign.subheadline_ar,
        perks_ar: campaign.perks_ar,
        max_slots: campaign.max_slots,
        discount_percent: campaign.discount_percent,
        locked_price_forever: campaign.locked_price_forever,
        perks: campaign.perks,
        is_active: campaign.is_active,
      })
      .eq("id", campaign.id);
    setSaving(false);
    if (error) {
      toast.error("Save failed: " + error.message);
    } else {
      toast.success("Campaign updated");
    }
  };

  const addPerk = () => {
    if (!campaign || !newPerk.trim()) return;
    setCampaign({ ...campaign, perks: [...campaign.perks, newPerk.trim()] });
    setNewPerk("");
  };

  const removePerk = (i: number) => {
    if (!campaign) return;
    setCampaign({ ...campaign, perks: campaign.perks.filter((_, idx) => idx !== i) });
  };

  const addPerkAr = () => {
    if (!campaign || !newPerkAr.trim()) return;
    setCampaign({ ...campaign, perks_ar: [...campaign.perks_ar, newPerkAr.trim()] });
    setNewPerkAr("");
  };

  const removePerkAr = (i: number) => {
    if (!campaign) return;
    setCampaign({ ...campaign, perks_ar: campaign.perks_ar.filter((_, idx) => idx !== i) });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Launch Promotions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (!campaign) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Launch Promotions</CardTitle>
          <CardDescription>No campaigns configured yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pct = (campaign.claimed_slots / campaign.max_slots) * 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Launch Promotion — {campaign.name}
            </CardTitle>
            <CardDescription>
              Configure the founding-cohort offer shown on the landing pricing section.
            </CardDescription>
          </div>
          <Badge variant={campaign.is_active ? "default" : "secondary"}>
            {campaign.is_active ? "Live" : "Paused"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Live counter */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {campaign.claimed_slots} / {campaign.max_slots} slots claimed
            </span>
            <span className="text-xs text-muted-foreground">
              {campaign.max_slots - campaign.claimed_slots} remaining
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Campaign name (internal)</Label>
            <Input value={campaign.name} onChange={e => setCampaign({ ...campaign, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Badge label</Label>
            <Input value={campaign.badge_label} onChange={e => setCampaign({ ...campaign, badge_label: e.target.value })} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Headline</Label>
          <Input value={campaign.headline} onChange={e => setCampaign({ ...campaign, headline: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label>Subheadline</Label>
          <Textarea
            rows={3}
            value={campaign.subheadline || ""}
            onChange={e => setCampaign({ ...campaign, subheadline: e.target.value })}
          />
        </div>

        {/* Arabic translations */}
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Arabic translations (عربي)</h4>
            <span className="text-xs text-muted-foreground">Shown when language is Arabic. Falls back to English if empty.</span>
          </div>

          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Badge label (Arabic)</Label>
            <Input
              value={campaign.badge_label_ar || ""}
              onChange={e => setCampaign({ ...campaign, badge_label_ar: e.target.value })}
              placeholder="مجموعة التأسيس 50"
            />
          </div>

          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Headline (Arabic)</Label>
            <Input
              value={campaign.headline_ar || ""}
              onChange={e => setCampaign({ ...campaign, headline_ar: e.target.value })}
              placeholder="خصم 50% في السنة الأولى."
            />
          </div>

          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Subheadline (Arabic)</Label>
            <Textarea
              rows={3}
              value={campaign.subheadline_ar || ""}
              onChange={e => setCampaign({ ...campaign, subheadline_ar: e.target.value })}
              placeholder="أول 50 مطعمًا..."
            />
          </div>

          <div className="space-y-2">
            <Label>Perks (Arabic)</Label>
            <div className="space-y-2" dir="rtl">
              {campaign.perks_ar.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={p}
                    onChange={e => {
                      const next = [...campaign.perks_ar];
                      next[i] = e.target.value;
                      setCampaign({ ...campaign, perks_ar: next });
                    }}
                  />
                  <Button variant="ghost" size="icon" onClick={() => removePerkAr(i)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="أضف ميزة جديدة…"
                  value={newPerkAr}
                  onChange={e => setNewPerkAr(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addPerkAr())}
                />
                <Button variant="outline" size="icon" onClick={addPerkAr}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Max slots</Label>
            <Input
              type="number"
              min={1}
              value={campaign.max_slots}
              onChange={e => setCampaign({ ...campaign, max_slots: parseInt(e.target.value) || 1 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Discount %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={campaign.discount_percent}
              onChange={e => setCampaign({ ...campaign, discount_percent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Locked forever</Label>
            <div className="flex items-center h-10">
              <Switch
                checked={campaign.locked_price_forever}
                onCheckedChange={v => setCampaign({ ...campaign, locked_price_forever: v })}
              />
              <span className="text-sm text-muted-foreground ml-3">
                {campaign.locked_price_forever ? "Price locked for life" : "Standard renewal pricing"}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Perks (shown as bullets on landing)</Label>
          <div className="space-y-2">
            {campaign.perks.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={p}
                  onChange={e => {
                    const next = [...campaign.perks];
                    next[i] = e.target.value;
                    setCampaign({ ...campaign, perks: next });
                  }}
                />
                <Button variant="ghost" size="icon" onClick={() => removePerk(i)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a new perk…"
                value={newPerk}
                onChange={e => setNewPerk(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addPerk())}
              />
              <Button variant="outline" size="icon" onClick={addPerk}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center gap-3">
            <Switch
              checked={campaign.is_active}
              onCheckedChange={v => setCampaign({ ...campaign, is_active: v })}
            />
            <span className="text-sm text-muted-foreground">
              {campaign.is_active ? "Live on landing page" : "Hidden from public"}
            </span>
          </div>
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};