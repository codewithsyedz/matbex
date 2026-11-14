import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Package, Sparkles, CreditCard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAddonCatalog, useMyTenantAddons } from "@/hooks/useAddons";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AddonCatalog() {
  const { isOwner, refreshProfile } = useAuth();
  const { data: catalog, isLoading } = useAddonCatalog();
  const { data: owned, refetch: refetchOwned } = useMyTenantAddons();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const ownedActiveIds = new Set(
    (owned ?? [])
      .filter((ta) => ta.status === "active" || ta.status === "pending")
      .map((ta) => ta.addon_id)
  );

  // Handle Stripe + Checkout.com return
  useEffect(() => {
    const stripeSessionId = searchParams.get("addon_session_id");
    const ckoRef = searchParams.get("cko_addon_ref");
    if (!stripeSessionId && !ckoRef) return;
    (async () => {
      try {
        let data: any, error: any;
        if (stripeSessionId) {
          ({ data, error } = await db.functions.invoke(
            "verify-addon-purchase",
            { body: { session_id: stripeSessionId } },
          ));
        } else {
          // Look up the pending tenant_addon row by reference to get the
          // Checkout.com hosted-payment id stored in stripe_checkout_session_id.
          const { data: row } = await db
            .from("tenant_addons")
            .select("stripe_checkout_session_id")
            .eq("provider", "checkout_com")
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (row?.stripe_checkout_session_id) {
            ({ data, error } = await db.functions.invoke(
              "verify-addon-purchase-cko",
              { body: { session_id: row.stripe_checkout_session_id } },
            ));
          }
        }
        if (error) throw error;
        if (data?.activated) {
          toast.success("Addon activated!");
          await refreshProfile();
          refetchOwned();
        } else {
          toast.info("Payment pending — we'll activate the addon shortly.");
        }
      } catch (err: any) {
        toast.error(err.message ?? "Could not verify purchase");
      } finally {
        searchParams.delete("addon_session_id");
        searchParams.delete("cko_addon_ref");
        searchParams.delete("status");
        setSearchParams(searchParams, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBuy = async (
    addonId: string,
    provider: "stripe" | "checkout_com" = "stripe",
  ) => {
    if (!isOwner) {
      toast.error("Only owners can purchase addons");
      return;
    }
    setPurchasing(addonId);
    try {
      const fn =
        provider === "checkout_com"
          ? "create-addon-checkout-cko"
          : "create-addon-checkout";
      const { data, error } = await db.functions.invoke(fn, {
        body: { addon_id: addonId },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to start checkout");
    } finally {
      setPurchasing(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!catalog || catalog.length === 0) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No addons available yet. Check back soon.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {catalog.map((a) => {
        const isOwned = ownedActiveIds.has(a.id);
        const canBuy = !!a.stripe_price_id && !isOwned;
        return (
          <Card
            key={a.id}
            className={cn(
              "border-border/40 relative",
              isOwned && "ring-1 ring-primary border-primary"
            )}
          >
            {isOwned && (
              <Badge className="absolute -top-2 right-4" variant="default">
                <Check className="h-3 w-3 mr-1" /> Active
              </Badge>
            )}
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <CardTitle className="text-base font-medium">{a.name}</CardTitle>
              </div>
              {a.description && (
                <CardDescription>{a.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-2xl font-semibold text-foreground">
                  {a.currency} {a.price.toFixed(2)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {a.billing_type === "recurring" ? " /month" : " one-time"}
                </span>
              </div>

              {(a.included_features.length > 0 ||
                Object.keys(a.quota_boosts).length > 0) && (
                <ul className="space-y-1.5">
                  {a.included_features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="capitalize">{f.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                  {Object.entries(a.quota_boosts as Record<string, number>).map(([k, v]) => (
                    <li
                      key={k}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span>
                        +{v} {k.replace(/_/g, " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {isOwned ? (
                <Button className="w-full" variant="outline" disabled>
                  Active
                </Button>
              ) : !a.stripe_price_id ? (
                <Button className="w-full" variant="outline" disabled>
                  Contact sales
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="w-full"
                      disabled={!canBuy || purchasing !== null}
                    >
                      {purchasing === a.id ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing…
                        </>
                      ) : (
                        "Get addon"
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => handleBuy(a.id, "stripe")}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay with Stripe
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBuy(a.id, "checkout_com")}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay with Checkout.com
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
