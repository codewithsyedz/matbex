import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SupplierApHeadGapCard() {
  const { tenant } = useAuth();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const { data: missing = [], isLoading } = useQuery({
    queryKey: ["supplier-ap-head-gaps", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("suppliers")
        .select("id, name")
        .eq("restaurant_id", tenant!.id)
        .eq("is_active", true)
        .is("ap_account_id", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const createHeads = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("backfill_supplier_ap_accounts", {
        p_tenant_id: tenant!.id,
      });
      if (error) throw error;
      return (data as { created?: number } | null)?.created ?? 0;
    },
    onSuccess: (created) => {
      toast.success(
        created > 0
          ? `Created ${created} supplier payable ${created === 1 ? "head" : "heads"}`
          : "No missing payable heads found",
      );
      queryClient.invalidateQueries({ queryKey: ["supplier-ap-head-gaps"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not create payable heads");
    },
  });

  if (isLoading || missing.length === 0) {
    if (isLoading) return null;
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="pt-6 flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="font-light">
            Every active supplier has a dedicated payable head in the Chart of Accounts.
          </span>
        </CardContent>
      </Card>
    );
  }

  const visible = showAll ? missing : missing.slice(0, 8);

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="pt-6 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium">
                {missing.length} supplier{missing.length === 1 ? "" : "s"} without a payable head
              </p>
              <p className="text-xs font-light text-muted-foreground">
                Their unpaid bills fall back to the shared Accounts Payable control account.
                Creating a head files each supplier under its own code (2500–2899).
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={() => createHeads.mutate()}
            disabled={createHeads.isPending}
          >
            {createHeads.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            Create missing heads
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {visible.map((s) => (
            <Badge key={s.id} variant="outline" className="font-light">
              {s.name}
            </Badge>
          ))}
          {missing.length > visible.length && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowAll(true)}
            >
              +{missing.length - visible.length} more
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
