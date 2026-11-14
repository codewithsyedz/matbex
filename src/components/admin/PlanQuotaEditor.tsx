import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Save, Loader2, Users, UtensilsCrossed, Image, Mail } from "lucide-react";

interface QuotaLimits {
  users?: number;
  owner?: number;
  manager?: number;
  cashier?: number;
  menu_items?: number;
  image_uploads?: number;
  email_reminders?: number;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  quota_limits: QuotaLimits;
}

interface PlanQuotaEditorProps {
  plan: Plan;
  onSaved: () => void;
}

const QUOTA_FIELDS = [
  { key: "users", label: "Total Users", icon: Users, description: "Maximum team members" },
  { key: "owner", label: "Owners", icon: Users, description: "Maximum owner accounts" },
  { key: "manager", label: "Managers", icon: Users, description: "Maximum manager accounts" },
  { key: "cashier", label: "Cashiers", icon: Users, description: "Maximum cashier accounts" },
  { key: "menu_items", label: "Menu Items", icon: UtensilsCrossed, description: "Maximum menu items" },
  { key: "image_uploads", label: "Image Uploads", icon: Image, description: "Maximum images (lifetime)" },
  { key: "email_reminders", label: "Email Reminders", icon: Mail, description: "Maximum emails (monthly)" },
] as const;

export function PlanQuotaEditor({ plan, onSaved }: PlanQuotaEditorProps) {
  const [quotas, setQuotas] = useState<QuotaLimits>(plan.quota_limits || {});
  const [enabledFields, setEnabledFields] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    QUOTA_FIELDS.forEach((f) => {
      initial[f.key] = quotas[f.key as keyof QuotaLimits] !== undefined;
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  const handleToggle = (key: string, enabled: boolean) => {
    setEnabledFields((prev) => ({ ...prev, [key]: enabled }));
    if (!enabled) {
      setQuotas((prev) => {
        const updated = { ...prev };
        delete updated[key as keyof QuotaLimits];
        return updated;
      });
    }
  };

  const handleValueChange = (key: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setQuotas((prev) => ({
      ...prev,
      [key]: numValue > 0 ? numValue : undefined,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Clean quotas - only include enabled fields with values
      const cleanedQuotas: QuotaLimits = {};
      QUOTA_FIELDS.forEach((f) => {
        if (enabledFields[f.key] && quotas[f.key as keyof QuotaLimits]) {
          cleanedQuotas[f.key as keyof QuotaLimits] = quotas[f.key as keyof QuotaLimits];
        }
      });

      const { error } = await db
        .from("plans")
        .update({ quota_limits: JSON.parse(JSON.stringify(cleanedQuotas)) })
        .eq("id", plan.id);

      if (error) throw error;

      toast.success(`Quotas updated for ${plan.name} plan`);
      onSaved();
    } catch (error) {
      console.error("Error saving quotas:", error);
      toast.error("Failed to save quotas");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(quotas) !== JSON.stringify(plan.quota_limits || {});

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium capitalize">{plan.name} Plan Quotas</CardTitle>
        <CardDescription>
          ${plan.price}/month - Set usage limits for this plan
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {QUOTA_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <field.icon className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">{field.label}</Label>
              </div>
              <Switch
                checked={enabledFields[field.key]}
                onCheckedChange={(checked) => handleToggle(field.key, checked)}
              />
            </div>
            {enabledFields[field.key] && (
              <div className="flex items-center gap-2 pl-6">
                <Input
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={quotas[field.key as keyof QuotaLimits] || ""}
                  onChange={(e) => handleValueChange(field.key, e.target.value)}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">{field.description}</span>
              </div>
            )}
          </div>
        ))}

        <Separator />

        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="w-full"
          variant={hasChanges ? "default" : "outline"}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Quotas
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
