import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Globe, Check, X, Loader2, ExternalLink, Copy, QrCode, Sparkles, Lock } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useTenantDomain } from "@/hooks/useTenantDomain";
import { cn } from "@/lib/utils";
import { CustomDomainSetup } from "./CustomDomainSetup";

const ROOT_DOMAIN = "matbex.com";

export function SubdomainSetup() {
  const { hasFeature, tenant, restaurant } = useAuth();
  const { domain, checkSubdomainAvailability, saveSubdomain, isSavingSubdomain } = useTenantDomain();
  const [subdomain, setSubdomain] = useState("");
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    if (domain?.subdomain) {
      setSubdomain(domain.subdomain);
      setIsAvailable(true);
    }
  }, [domain]);

  useEffect(() => {
    const checkAvailability = async () => {
      if (subdomain.length < 3) {
        setIsAvailable(null);
        return;
      }

      if (domain?.subdomain === subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "")) {
        setIsAvailable(true);
        return;
      }

      setIsChecking(true);
      const available = await checkSubdomainAvailability(subdomain);
      setIsAvailable(available);
      setIsChecking(false);
    };

    const debounce = setTimeout(checkAvailability, 500);
    return () => clearTimeout(debounce);
  }, [subdomain, domain?.subdomain, checkSubdomainAvailability]);

  const handleSave = () => {
    if (isAvailable && subdomain.length >= 3) {
      saveSubdomain(subdomain);
      setRenameOpen(false);
    }
  };

  const handleProvision = async () => {
    if (!tenant?.id) return;
    setIsProvisioning(true);
    try {
      const { error } = await (db.rpc as any)("provision_tenant_subdomain", {
        _tenant_id: tenant.id,
      });
      if (error) throw error;
      toast.success("Your storefront subdomain is live.");
      // useTenantDomain will refetch on next focus; trigger immediate refresh
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to provision subdomain");
    } finally {
      setIsProvisioning(false);
    }
  };

  const normalizedSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const liveSubdomain = domain?.subdomain ?? "";
  const liveUrl = liveSubdomain ? `https://${liveSubdomain}.${ROOT_DOMAIN}` : "";
  const previewUrl = `${normalizedSubdomain}.${ROOT_DOMAIN}`;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  };

  // Plan gate
  if (!hasFeature("public_subdomain")) {
    return (
      <LockedFeatureScreen
        featureName="Online Storefront"
        description="Get a public landing page at your-restaurant.matbex.com to share your menu, hours, and online-ordering link. Available on Pro and Enterprise plans."
        featureKey="public_subdomain"
      />
    );
  }

  const isLive = !!liveSubdomain && domain?.domain_status === "active";

  return (
    <div className="space-y-6">
      {/* Live storefront card */}
      {isLive ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-emerald-500/10">
                <Sparkles className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  Your storefront is live
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </CardTitle>
                <CardDescription>
                  Share this address with guests, on receipts, and across social.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-md bg-background border text-sm font-mono truncate">
                {liveUrl}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(liveUrl)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.open(liveUrl, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Visit
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <QrCode className="h-4 w-4 mr-2" />
                    QR
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{restaurant?.name ?? "Storefront"} QR code</DialogTitle>
                    <DialogDescription>
                      Print or display this code so guests can open your storefront instantly.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="p-4 bg-white rounded-lg">
                      <QRCodeSVG value={liveUrl} size={220} includeMargin={false} />
                    </div>
                    <code className="text-xs text-muted-foreground">{liveUrl}</code>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <Button asChild size="sm" variant="default">
                <Link to="/web-builder">Customize page</Link>
              </Button>
              <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost">Rename subdomain</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rename your subdomain</DialogTitle>
                    <DialogDescription>
                      The old address will redirect to the new one for 90 days. Choose carefully —
                      frequent renames break shared links and printed QR codes.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          value={subdomain}
                          onChange={(e) =>
                            setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                          }
                          placeholder="your-restaurant"
                          className={cn(
                            "pr-10",
                            isAvailable === true && "border-emerald-500 focus-visible:ring-emerald-500",
                            isAvailable === false && "border-destructive focus-visible:ring-destructive"
                          )}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {isChecking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                          {!isChecking && isAvailable === true && <Check className="h-4 w-4 text-emerald-500" />}
                          {!isChecking && isAvailable === false && <X className="h-4 w-4 text-destructive" />}
                        </div>
                      </div>
                      <span className="text-muted-foreground font-medium">.{ROOT_DOMAIN}</span>
                    </div>
                    {subdomain.length >= 3 && isAvailable === false && (
                      <p className="text-xs text-destructive">This subdomain is already taken.</p>
                    )}
                    <Button
                      onClick={handleSave}
                      disabled={!isAvailable || subdomain.length < 3 || isSavingSubdomain || subdomain === liveSubdomain}
                      className="w-full"
                    >
                      {isSavingSubdomain ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Confirm rename"
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      ) : liveSubdomain ? (
        // Has a subdomain but not active (e.g. suspended)
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base font-medium">Storefront paused</CardTitle>
            </div>
            <CardDescription>
              Your subdomain <code>{liveSubdomain}.{ROOT_DOMAIN}</code> is currently inactive.
              Contact support if this is unexpected.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        // No subdomain provisioned yet — offer one-click provision
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Claim your storefront address</CardTitle>
                <CardDescription>
                  We'll generate a free <code>your-name.{ROOT_DOMAIN}</code> address from your restaurant name.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={handleProvision} disabled={isProvisioning}>
              {isProvisioning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Provisioning...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate my subdomain
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Manual entry (only when no live subdomain yet — fallback if auto-provision was skipped) */}
      {!liveSubdomain && (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-muted">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Or pick a custom subdomain</CardTitle>
              <CardDescription>
                Choose your own address on the Matbex network.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-restaurant"
                className={cn(
                  "pr-10",
                  isAvailable === true && "border-emerald-500 focus-visible:ring-emerald-500",
                  isAvailable === false && "border-destructive focus-visible:ring-destructive"
                )}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isChecking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {!isChecking && isAvailable === true && <Check className="h-4 w-4 text-emerald-500" />}
                {!isChecking && isAvailable === false && <X className="h-4 w-4 text-destructive" />}
              </div>
            </div>
            <span className="text-muted-foreground font-medium">.{ROOT_DOMAIN}</span>
          </div>

          {subdomain.length >= 3 && (
            <div className="flex items-center gap-2 text-sm">
              {isAvailable ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <Check className="h-3 w-3 mr-1" />
                  Available
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                  <X className="h-3 w-3 mr-1" />
                  Taken
                </Badge>
              )}
              {isAvailable && (
                <span className="text-muted-foreground">
                  Your page will be at{" "}
                  <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs">
                    {previewUrl}
                  </code>
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={!isAvailable || subdomain.length < 3 || isSavingSubdomain}
            >
              {isSavingSubdomain ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Subdomain"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Custom Domain Section */}
      <CustomDomainSetup />
    </div>
  );
}
