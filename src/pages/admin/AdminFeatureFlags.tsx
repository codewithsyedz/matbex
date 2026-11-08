import { useState } from "react";
import { Flag, Plus, Trash2, Lock } from "lucide-react";
import { useFeatureFlagAdmin } from "@/hooks/useFeatureFlags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const PLAN_OPTIONS = [
  { value: "__none__", label: "Available on all plans" },
  { value: "free", label: "Free and above" },
  { value: "pro", label: "Pro and above (paid)" },
  { value: "enterprise", label: "Enterprise only" },
];

export default function AdminFeatureFlags() {
  const { flags, upsert, toggle, setMinPlan, remove } = useFeatureFlagAdmin();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    key: string;
    description: string;
    enabled: boolean;
    min_plan: string;
  }>({ key: "", description: "", enabled: false, min_plan: "__none__" });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.key.trim()) {
      toast.error("Flag key is required");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        key: form.key.trim(),
        enabled: form.enabled,
        description: form.description.trim() || null,
        min_plan: form.min_plan === "__none__" ? null : form.min_plan,
      });
      toast.success("Feature flag saved");
      setForm({ key: "", description: "", enabled: false, min_plan: "__none__" });
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save flag");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, next: boolean) => {
    try {
      await toggle(id, next);
      toast.success(next ? "Flag enabled" : "Flag disabled");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update flag");
    }
  };

  const handleDelete = async (id: string, key: string) => {
    if (!confirm(`Delete flag "${key}"? This cannot be undone.`)) return;
    try {
      await remove(id);
      toast.success("Flag deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to delete flag");
    }
  };

  const handleMinPlan = async (id: string, value: string) => {
    try {
      await setMinPlan(id, value === "__none__" ? null : value);
      toast.success("Plan gate updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update plan gate");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Flag className="h-6 w-6 text-primary" />
            Feature Flags
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">
            Toggle features in production without redeploying. Changes propagate in real time.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New flag
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create feature flag</DialogTitle>
              <DialogDescription>
                Use a stable, snake_case key (e.g. <code>new_pos_layout</code>). Reference it in
                code with <code>useFeatureFlag("your_key")</code>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="key">Key</Label>
                <Input
                  id="key"
                  placeholder="new_pos_layout"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  placeholder="What does this flag control?"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Enabled by default</p>
                  <p className="text-xs text-muted-foreground">Turn on for all tenants</p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="min_plan">Minimum plan (entitlement)</Label>
                <Select
                  value={form.min_plan}
                  onValueChange={(v) => setForm({ ...form, min_plan: v })}
                >
                  <SelectTrigger id="min_plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Tenants on lower plans will see this feature locked even when the flag is on.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "Saving..." : "Save flag"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {flags.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Flag className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No feature flags yet. Create your first one to control features remotely.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {flags.map((flag) => (
            <Card key={flag.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <code className="text-sm bg-muted px-2 py-0.5 rounded">{flag.key}</code>
                    {flag.enabled ? (
                      <Badge variant="default">Live</Badge>
                    ) : (
                      <Badge variant="secondary">Off</Badge>
                    )}
                    {flag.min_plan && (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="h-3 w-3" />
                        {flag.min_plan}+
                      </Badge>
                    )}
                  </CardTitle>
                  {flag.description && (
                    <CardDescription>{flag.description}</CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={flag.min_plan ?? "__none__"}
                    onValueChange={(v) => handleMinPlan(flag.id, v)}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={flag.enabled}
                    onCheckedChange={(v) => handleToggle(flag.id, v)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(flag.id, flag.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground pt-0">
                {flag.rollout_tenant_ids?.length > 0 && (
                  <p>Force-enabled for {flag.rollout_tenant_ids.length} tenant(s)</p>
                )}
                {flag.disabled_tenant_ids?.length > 0 && (
                  <p>Force-disabled for {flag.disabled_tenant_ids.length} tenant(s)</p>
                )}
                <p className="mt-1">Updated {new Date(flag.updated_at).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}