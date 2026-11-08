import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Plus, Calendar } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  price: number;
}

interface CreateTenantDialogProps {
  plans: Plan[];
  onCreated: () => void;
}

export function CreateTenantDialog({ plans, onCreated }: CreateTenantDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenantName: "",
    restaurantName: "",
    ownerEmail: "",
    planId: "",
    isTrial: false,
    trialDays: 14,
    currency: "SAR",
    timezone: "Asia/Riyadh",
  });

  const handleCreate = async () => {
    if (!formData.tenantName || !formData.restaurantName) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);

    try {
      // Create tenant
      const trialEndsAt = formData.isTrial
        ? new Date(Date.now() + formData.trialDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const { data: tenant, error: tenantError } = await db
        .from("tenants")
        .insert({
          name: formData.tenantName,
          slug: formData.tenantName.toLowerCase().replace(/\s+/g, "-"),
          status: formData.isTrial ? "trial" : "active",
          plan_id: formData.planId || null,
          trial_ends_at: trialEndsAt,
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Create primary restaurant
      const { error: restaurantError } = await db
        .from("restaurants")
        .insert({
          tenant_id: tenant.id,
          name: formData.restaurantName,
          currency: formData.currency,
          timezone: formData.timezone,
          is_primary: true,
          status: "active",
        });

      if (restaurantError) throw restaurantError;

      toast.success(`Tenant "${formData.tenantName}" created successfully`);
      setOpen(false);
      resetForm();
      onCreated();
    } catch (error) {
      console.error("Error creating tenant:", error);
      toast.error("Failed to create tenant");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      tenantName: "",
      restaurantName: "",
      ownerEmail: "",
      planId: "",
      isTrial: false,
      trialDays: 14,
      currency: "SAR",
      timezone: "Asia/Riyadh",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Tenant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Tenant</DialogTitle>
          <DialogDescription>
            Manually onboard a new tenant with initial settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tenant Name */}
          <div className="space-y-2">
            <Label htmlFor="tenantName">Tenant Name *</Label>
            <Input
              id="tenantName"
              placeholder="Acme Restaurant Group"
              value={formData.tenantName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, tenantName: e.target.value }))
              }
            />
          </div>

          {/* Restaurant Name */}
          <div className="space-y-2">
            <Label htmlFor="restaurantName">Primary Restaurant Name *</Label>
            <Input
              id="restaurantName"
              placeholder="Main Branch"
              value={formData.restaurantName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, restaurantName: e.target.value }))
              }
            />
          </div>

          {/* Plan Selection */}
          <div className="space-y-2">
            <Label>Subscription Plan</Label>
            <Select
              value={formData.planId}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, planId: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name} - ${plan.price}/mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Trial Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Start with Trial</Label>
              <p className="text-xs text-muted-foreground">
                Enable trial period for this tenant
              </p>
            </div>
            <Switch
              checked={formData.isTrial}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, isTrial: checked }))
              }
            />
          </div>

          {/* Trial Days */}
          {formData.isTrial && (
            <div className="space-y-2">
              <Label htmlFor="trialDays">Trial Duration (days)</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="trialDays"
                  type="number"
                  min={1}
                  max={90}
                  value={formData.trialDays}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      trialDays: parseInt(e.target.value) || 14,
                    }))
                  }
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
          )}

          {/* Currency & Timezone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select
                value={formData.currency}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, currency: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="AED">AED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={formData.timezone}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, timezone: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Riyadh">Asia/Riyadh</SelectItem>
                  <SelectItem value="America/New_York">America/New_York</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="Asia/Dubai">Asia/Dubai</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
