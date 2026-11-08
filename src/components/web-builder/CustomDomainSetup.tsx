import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Globe2, 
  Check, 
  X, 
  Loader2, 
  ExternalLink, 
  Copy, 
  RefreshCw,
  Shield,
  AlertCircle,
  CheckCircle2,
  Clock
} from "lucide-react";
import { useTenantDomain } from "@/hooks/useTenantDomain";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const CNAME_TARGET = "cname.matbex.com";
const TXT_PREFIX = "_matbex-verify";

export function CustomDomainSetup() {
  const { hasFeature } = useAuth();
  const { 
    domain, 
    saveCustomDomain, 
    verifyDomain, 
    removeDomain,
    isSavingDomain, 
    isVerifying,
    isRemovingDomain
  } = useTenantDomain();
  
  const [customDomain, setCustomDomain] = useState("");
  const [isValidFormat, setIsValidFormat] = useState<boolean | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    txt_ok: boolean;
    cname_ok: boolean;
    message: string;
  } | null>(null);

  const isPro = hasFeature("custom_domain");
  const hasCustomDomain = !!domain?.custom_domain;

  useEffect(() => {
    if (domain?.custom_domain) {
      setCustomDomain(domain.custom_domain);
    }
  }, [domain]);

  // Validate domain format
  useEffect(() => {
    if (!customDomain) {
      setIsValidFormat(null);
      return;
    }
    
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
    setIsValidFormat(domainRegex.test(customDomain));
  }, [customDomain]);

  const handleSave = () => {
    if (isValidFormat && customDomain) {
      saveCustomDomain(customDomain.toLowerCase());
    }
  };

  const handleVerify = () => {
    setVerifyResult(null);
    verifyDomain(undefined, {
      onSuccess: async () => {
        // Pull fresh result via direct call so we can show per-record check state
        try {
          const { data } = await supabase.functions.invoke("verify-custom-domain", {
            body: { domain_id: domain?.id },
          });
          if (data) {
            setVerifyResult({
              txt_ok: !!data.txt_ok,
              cname_ok: !!data.cname_ok,
              message: data.message || "",
            });
          }
        } catch (_) { /* noop */ }
      },
    });
  };

  const handleRemove = () => {
    if (window.confirm("Are you sure you want to remove this custom domain?")) {
      removeDomain();
      setCustomDomain("");
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const getStatusBadge = () => {
    if (!domain?.custom_domain) return null;
    
    const status = domain.domain_status;
    
    switch (status) {
      case "active":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case "verifying":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Verifying DNS
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending Setup
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
            <X className="h-3 w-3 mr-1" />
            Verification Failed
          </Badge>
        );
      case "offline":
        return (
          <Badge className="bg-muted text-muted-foreground border-muted">
            <AlertCircle className="h-3 w-3 mr-1" />
            Offline
          </Badge>
        );
      default:
        return null;
    }
  };

  const getSSLBadge = () => {
    if (!domain?.custom_domain || domain.domain_status !== "active") return null;
    
    const sslStatus = domain.ssl_status;
    
    switch (sslStatus) {
      case "active":
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <Shield className="h-3 w-3 mr-1" />
            SSL Active
          </Badge>
        );
      case "provisioning":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            SSL Provisioning
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground">
            <Clock className="h-3 w-3 mr-1" />
            SSL Pending
          </Badge>
        );
    }
  };

  if (!isPro) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-muted">
              <Globe2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Custom Domain</CardTitle>
              <CardDescription>
                Map your brand identity to a dedicated address
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Custom domains are available on Pro and Enterprise tiers. 
              Upgrade to connect addresses like <code className="text-xs">www.yourrestaurant.com</code>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-primary/10">
              <Globe2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Custom Domain</CardTitle>
              <CardDescription>
                Map your brand identity to a dedicated address
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            {getSSLBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Domain Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Your Domain</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value.toLowerCase().replace(/\s/g, ""))}
                placeholder="www.yourrestaurant.com"
                disabled={hasCustomDomain && domain?.domain_status === "active"}
                className={cn(
                  "pr-10",
                  isValidFormat === true && "border-emerald-500 focus-visible:ring-emerald-500",
                  isValidFormat === false && "border-destructive focus-visible:ring-destructive"
                )}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {customDomain && isValidFormat === true && <Check className="h-4 w-4 text-emerald-500" />}
                {customDomain && isValidFormat === false && <X className="h-4 w-4 text-destructive" />}
              </div>
            </div>
          </div>
          {customDomain && isValidFormat === false && (
            <p className="text-xs text-destructive">
              Please enter a valid domain (e.g., yourrestaurant.com or www.yourrestaurant.com)
            </p>
          )}
        </div>

        {/* Action Buttons */}
        {!hasCustomDomain && (
          <Button
            onClick={handleSave}
            disabled={!isValidFormat || !customDomain || isSavingDomain}
          >
            {isSavingDomain ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <Globe2 className="h-4 w-4 mr-2" />
                Connect Domain
              </>
            )}
          </Button>
        )}

        {/* DNS Instructions */}
        {hasCustomDomain && domain?.domain_status !== "active" && (
          <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <h4 className="font-medium">DNS Configuration Required</h4>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Add these DNS records at your domain registrar to connect your domain:
            </p>

            <div className="space-y-3">
              {/* CNAME Record */}
              <div className="p-3 rounded-md bg-background border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">CNAME Record (Site)</span>
                    {verifyResult && (verifyResult.cname_ok
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <X className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => copyToClipboard(CNAME_TARGET, "CNAME target")}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">Type</span>
                    <p className="font-mono">CNAME</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Name</span>
                    <p className="font-mono break-all">{domain?.custom_domain}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Value</span>
                    <p className="font-mono">{CNAME_TARGET}</p>
                  </div>
                </div>
              </div>

              {/* TXT Record for verification */}
              {domain?.verification_token && (
                <div className="p-3 rounded-md bg-background border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase text-muted-foreground">TXT Record (Ownership)</span>
                      {verifyResult && (verifyResult.txt_ok
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <X className="h-3.5 w-3.5 text-destructive" />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => copyToClipboard(domain.verification_token!, "TXT value")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">Type</span>
                      <p className="font-mono">TXT</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Name</span>
                      <p className="font-mono break-all">{TXT_PREFIX}.{domain.custom_domain}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Value</span>
                      <p className="font-mono text-xs break-all">{domain.verification_token}</p>
                    </div>
                  </div>
                </div>
              )}

              {verifyResult && !verifyResult.cname_ok && !verifyResult.txt_ok && verifyResult.message && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{verifyResult.message}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Registrar guides:</span>
                <a href="https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/" target="_blank" rel="noopener" className="underline hover:text-primary">Cloudflare</a>
                <a href="https://www.godaddy.com/help/add-a-cname-record-19236" target="_blank" rel="noopener" className="underline hover:text-primary">GoDaddy</a>
                <a href="https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/" target="_blank" rel="noopener" className="underline hover:text-primary">Namecheap</a>
                <a href="https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-creating.html" target="_blank" rel="noopener" className="underline hover:text-primary">Route53</a>
              </div>
            </div>

            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                DNS propagation is in progress. Your brand will be live shortly. This can take up to 72 hours.
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-2">
              <Button onClick={handleVerify} disabled={isVerifying}>
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {verifyResult ? "Re-check now" : "Verify DNS"}
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={handleRemove}
                disabled={isRemovingDomain}
              >
                {isRemovingDomain ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Remove Domain"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Active Domain Info */}
        {hasCustomDomain && domain?.domain_status === "active" && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="font-medium text-emerald-600">Domain Active</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Your custom domain is live and serving your landing experience.
              </p>
              {domain.dns_verified_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  Verified on {new Date(domain.dns_verified_at).toLocaleDateString()}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://${domain.custom_domain}`, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Visit Site
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleRemove}
                disabled={isRemovingDomain}
                className="text-destructive hover:text-destructive"
              >
                {isRemovingDomain ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Disconnect Domain"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Failed state */}
        {hasCustomDomain && domain?.domain_status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {domain?.verification_error ||
                `DNS verification failed. Make sure ${domain?.custom_domain} CNAMEs to ${CNAME_TARGET} and the TXT record at ${TXT_PREFIX}.${domain?.custom_domain} contains your verification token.`}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
