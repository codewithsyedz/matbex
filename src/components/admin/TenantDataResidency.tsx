import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Globe, Lock, Shield, Loader2, History } from "lucide-react";
import { Link } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

type DataRegion = "global" | "ksa";

interface Props {
  tenantId: string;
  tenantName: string;
}

export function TenantDataResidency({ tenantId, tenantName }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [region, setRegion] = useState<DataRegion>("global");
  const [locked, setLocked] = useState(false);
  const [initial, setInitial] = useState<{ region: DataRegion; locked: boolean }>({
    region: "global",
    locked: false,
  });

  const fetchState = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("tenants")
      .select("data_region, residency_locked")
      .eq("id", tenantId)
      .single();
    if (error) {
      toast.error("Failed to load residency settings");
      setLoading(false);
      return;
    }
    const r = (data.data_region as DataRegion) || "global";
    const l = !!data.residency_locked;
    setRegion(r);
    setLocked(l);
    setInitial({ region: r, locked: l });
    setLoading(false);
  };

  useEffect(() => {
    fetchState();
  }, [tenantId]);

  const dirty = region !== initial.region || locked !== initial.locked;

  const handleSave = async () => {
    if (initial.locked && region !== initial.region) {
      const confirmed = window.confirm(
        `${tenantName} is residency-locked to ${initial.region.toUpperCase()}. Moving them to ${region.toUpperCase()} requires unlocking first and may breach the customer's data-residency agreement. Continue?`,
      );
      if (!confirmed) return;
    }
    if (region !== initial.region) {
      const confirmed = window.confirm(
        `Change data region for ${tenantName} from ${initial.region.toUpperCase()} to ${region.toUpperCase()}? This does NOT migrate existing data — it only changes which regional endpoint the app uses. The customer should be informed before this change.`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    const { error } = await db
      .from("tenants")
      .update({ data_region: region, residency_locked: locked })
      .eq("id", tenantId);
    setSaving(false);
    if (error) {
      toast.error(error.message || "Failed to update residency");
      return;
    }
    toast.success("Residency settings updated");
    setInitial({ region, locked });
  };

  if (loading) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Data Residency</CardTitle>
        </div>
        <CardDescription>
          Controls which regional backend serves this tenant. Used for KSA PDPL, SAMA, and ZATCA
          data-sovereignty compliance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Current:</span>
          <Badge variant={region === "ksa" ? "default" : "secondary"} className="uppercase">
            <Globe className="h-3 w-3 mr-1" />
            {region}
          </Badge>
          {locked && (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" />
              Locked
            </Badge>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="data-region">Data region</Label>
            <Select value={region} onValueChange={(v) => setRegion(v as DataRegion)}>
              <SelectTrigger id="data-region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (default)</SelectItem>
                <SelectItem value="ksa">KSA — Saudi Arabia (me-central2)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Endpoint hint only. Existing rows stay in their current project — data migration is a
              separate operation.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="residency-locked" className="flex items-center justify-between">
              <span>Residency locked</span>
              <Switch
                id="residency-locked"
                checked={locked}
                onCheckedChange={setLocked}
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              When enabled, future region changes require an explicit unlock first. Use after signing
              a data-residency DPA with the customer.
            </p>
          </div>
        </div>

        {initial.region === "ksa" && region === "global" && (
          <Alert variant="destructive">
            <AlertTitle>You are moving a KSA tenant back to Global</AlertTitle>
            <AlertDescription>
              This may violate the customer's data-residency agreement. Confirm legal sign-off
              before saving.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button asChild variant="ghost" className="mr-auto">
            <Link to="/admin/residency-audit">
              <History className="h-4 w-4 mr-2" />
              View audit log
            </Link>
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setRegion(initial.region);
              setLocked(initial.locked);
            }}
          >
            Reset
          </Button>
          <Button disabled={!dirty || saving} onClick={handleSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save residency
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}