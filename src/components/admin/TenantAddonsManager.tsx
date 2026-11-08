import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Gift, Ban, Plus } from "lucide-react";
import { useAddonCatalog, useTenantAddons } from "@/hooks/useAddons";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  tenantId: string;
}

export function TenantAddonsManager({ tenantId }: Props) {
  const { data: catalog } = useAddonCatalog({ includeInactive: true });
  const { data: tenantAddons, refetch, isLoading } = useTenantAddons(tenantId);
  const [selectedAddon, setSelectedAddon] = useState<string>("");
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const handleGrant = async () => {
    if (!selectedAddon) return;
    setGranting(true);
    try {
      const { data: userData } = await db.auth.getUser();
      const { error } = await db.from("tenant_addons" as any).insert({
        tenant_id: tenantId,
        addon_id: selectedAddon,
        status: "active",
        source: "manual_grant",
        granted_by: userData.user?.id,
        activated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Addon granted");
      setSelectedAddon("");
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to grant addon");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this addon? Tenant will lose access immediately.")) return;
    setRevoking(id);
    try {
      const { error } = await db
        .from("tenant_addons" as any)
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Addon revoked");
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to revoke");
    } finally {
      setRevoking(null);
    }
  };

  const activeAddonIds = new Set(
    (tenantAddons ?? [])
      .filter((ta) => ta.status === "active" || ta.status === "pending")
      .map((ta) => ta.addon_id)
  );
  const grantable = (catalog ?? []).filter((a) => !activeAddonIds.has(a.id));

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Addons</CardTitle>
        <CardDescription>
          Grant or revoke paid module addons for this tenant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={selectedAddon} onValueChange={setSelectedAddon}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Pick an addon to grant…" />
            </SelectTrigger>
            <SelectContent>
              {grantable.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">
                  No addons available to grant.
                </div>
              ) : (
                grantable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency} {a.price.toFixed(2)})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleGrant} disabled={!selectedAddon || granting}>
            {granting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Gift className="h-4 w-4 mr-2" />
            )}
            Grant
          </Button>
        </div>

        <Separator />

        {isLoading ? (
          <div className="flex justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !tenantAddons || tenantAddons.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No addons assigned.
          </p>
        ) : (
          <div className="space-y-2">
            {tenantAddons.map((ta) => (
              <div
                key={ta.id}
                className="flex items-center justify-between p-3 rounded-md border border-border/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">
                      {ta.addon?.name ?? "Unknown addon"}
                    </p>
                    <Badge
                      variant={
                        ta.status === "active"
                          ? "default"
                          : ta.status === "pending"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-[10px]"
                    >
                      {ta.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {ta.source === "manual_grant" ? "Granted" : "Purchased"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ta.activated_at
                      ? `Active since ${format(new Date(ta.activated_at), "MMM d, yyyy")}`
                      : `Created ${format(new Date(ta.created_at), "MMM d, yyyy")}`}
                  </p>
                </div>
                {(ta.status === "active" || ta.status === "pending") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(ta.id)}
                    disabled={revoking === ta.id}
                  >
                    {revoking === ta.id ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4 mr-1" />
                    )}
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
