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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAddonCatalog, Addon } from "@/hooks/useAddons";
import { AddonFormDialog } from "@/components/admin/AddonFormDialog";
import { Plus, Pencil, Trash2, Loader2, Package } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

export default function AdminAddons() {
  const { data: addons, isLoading, refetch } = useAddonCatalog({ includeInactive: true });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Addon | null>(null);

  const handleEdit = (a: Addon) => {
    setEditing(a);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleDelete = async (a: Addon) => {
    if (!confirm(`Delete addon "${a.name}"? Tenants who own it will lose access.`)) return;
    const { error } = await db.from("addons" as any).delete().eq("id", a.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Addon deleted");
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Module Addons
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paid feature packs that customers can purchase on top of their plan.
          </p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="h-4 w-4 mr-2" /> New addon
        </Button>
      </div>

      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base font-medium">Catalog</CardTitle>
          <CardDescription>
            Each addon bundles feature flags and quota boosts. Set a Stripe price ID to enable
            self-serve checkout, or leave empty for manual-grant only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !addons || addons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No addons yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Features</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Stripe</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addons.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.slug}</div>
                    </TableCell>
                    <TableCell>
                      {a.currency} {a.price.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {a.billing_type === "recurring" ? "Monthly" : "One-time"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {a.included_features.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          a.included_features.map((f) => (
                            <Badge key={f} variant="secondary" className="text-[10px]">
                              {f}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {Object.entries(a.quota_boosts).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          Object.entries(a.quota_boosts as Record<string, number>).map(([k, v]) => (
                            <Badge key={k} variant="outline" className="text-[10px]">
                              +{v} {k}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {a.stripe_price_id ? (
                        <Badge variant="default" className="text-[10px]">
                          Linked
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Manual only
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.is_active ? "default" : "secondary"}>
                        {a.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(a)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddonFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        addon={editing}
        onSaved={refetch}
      />
    </div>
  );
}
