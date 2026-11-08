import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import type { Addon, AddonBillingType } from "@/hooks/useAddons";

const FEATURE_FLAGS = [
  "daily_profit",
  "accounting",
  "inventory",
  "payroll",
  "chat",
  "cogs",
  "menu",
  "shifts",
  "advance_pay",
  "api_access",
  "multi_location",
  "email_reports",
  "advanced_reports",
  "web_builder",
];

const QUOTA_KEYS = ["users", "menu_items", "image_uploads", "email_reminders"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  addon?: Addon | null;
  onSaved?: () => void;
}

export function AddonFormDialog({ open, onOpenChange, addon, onSaved }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [billingType, setBillingType] = useState<AddonBillingType>("recurring");
  const [stripePriceId, setStripePriceId] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [quotas, setQuotas] = useState<Array<{ key: string; value: string }>>([]);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (addon) {
      setName(addon.name);
      setSlug(addon.slug);
      setDescription(addon.description ?? "");
      setIcon(addon.icon ?? "");
      setPrice(String(addon.price));
      setCurrency(addon.currency);
      setBillingType(addon.billing_type);
      setStripePriceId(addon.stripe_price_id ?? "");
      setFeatures(addon.included_features);
      setQuotas(
        Object.entries(addon.quota_boosts).map(([key, value]) => ({
          key,
          value: String(value),
        }))
      );
      setIsActive(addon.is_active);
      setSortOrder(String(addon.sort_order));
    } else {
      setName("");
      setSlug("");
      setDescription("");
      setIcon("");
      setPrice("0");
      setCurrency("USD");
      setBillingType("recurring");
      setStripePriceId("");
      setFeatures([]);
      setQuotas([]);
      setIsActive(true);
      setSortOrder("0");
    }
  }, [open, addon]);

  const toggleFeature = (key: string) => {
    setFeatures((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    if (!name.trim() || !slug.trim()) {
      toast.error("Name and slug are required");
      return;
    }
    const quotaBoosts: Record<string, number> = {};
    quotas.forEach((q) => {
      const n = Number(q.value);
      if (q.key.trim() && Number.isFinite(n) && n > 0) quotaBoosts[q.key.trim()] = n;
    });

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        description: description.trim() || null,
        icon: icon.trim() || null,
        price: Number(price) || 0,
        currency: currency.trim().toUpperCase() || "USD",
        billing_type: billingType,
        stripe_price_id: stripePriceId.trim() || null,
        included_features: features,
        quota_boosts: quotaBoosts,
        is_active: isActive,
        sort_order: Number(sortOrder) || 0,
      };

      const { error } = addon
        ? await supabase.from("addons" as any).update(payload).eq("id", addon.id)
        : await supabase.from("addons" as any).insert(payload);

      if (error) throw error;
      toast.success(addon ? "Addon updated" : "Addon created");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message ?? "Failed to save addon");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{addon ? "Edit addon" : "Create addon"}</DialogTitle>
          <DialogDescription>
            Bundle features and quota boosts into a paid addon that customers can purchase.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4 -mr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Inventory Pack"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="inventory-pack"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Billing</Label>
                <Select
                  value={billingType}
                  onValueChange={(v) => setBillingType(v as AddonBillingType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recurring">Monthly</SelectItem>
                    <SelectItem value="one_time">One-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Stripe price ID</Label>
              <Input
                value={stripePriceId}
                onChange={(e) => setStripePriceId(e.target.value)}
                placeholder="price_..."
              />
              <p className="text-xs text-muted-foreground">
                Create the product & price in Stripe first, then paste the price ID here.
                Leave empty to disable self-serve checkout (manual grant only).
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Included features</Label>
              <div className="grid grid-cols-2 gap-2">
                {FEATURE_FLAGS.map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={features.includes(key)}
                      onChange={() => toggleFeature(key)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>{key}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Quota boosts</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuotas((q) => [...q, { key: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add boost
                </Button>
              </div>
              {quotas.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add quota keys (e.g. users, menu_items) to increase tenant limits.
                </p>
              )}
              {quotas.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={q.key}
                    onValueChange={(v) =>
                      setQuotas((arr) =>
                        arr.map((x, idx) => (idx === i ? { ...x, key: v } : x))
                      )
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="quota key" />
                    </SelectTrigger>
                    <SelectContent>
                      {QUOTA_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={q.value}
                    onChange={(e) =>
                      setQuotas((arr) =>
                        arr.map((x, idx) =>
                          idx === i ? { ...x, value: e.target.value } : x
                        )
                      )
                    }
                    placeholder="amount"
                    className="w-32"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setQuotas((arr) => arr.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive addons are hidden from the catalog.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
