import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Smartphone, Eye, Loader2, Globe2, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface PagePreviewProps {
  subdomain: string | null;
  customDomain?: string | null;
  domainStatus?: string;
  theme: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string | null;
  isPublished: boolean;
  isPublishing: boolean;
  onPublish: () => void;
}

const themeStyles: Record<string, { bg: string; text: string; accent: string; overlay: string }> = {
  "fine-diner": {
    bg: "bg-zinc-900",
    text: "text-zinc-100",
    accent: "text-amber-400",
    overlay: "from-zinc-900/80 to-zinc-900/40",
  },
  "urban-cafe": {
    bg: "bg-stone-50",
    text: "text-stone-900",
    accent: "text-emerald-600",
    overlay: "from-stone-900/60 to-transparent",
  },
  "rustic-bistro": {
    bg: "bg-amber-50",
    text: "text-amber-900",
    accent: "text-orange-600",
    overlay: "from-amber-900/60 to-transparent",
  },
  "modern-minimal": {
    bg: "bg-white",
    text: "text-zinc-900",
    accent: "text-black",
    overlay: "from-black/50 to-transparent",
  },
  "vibrant-street": {
    bg: "bg-rose-50",
    text: "text-rose-900",
    accent: "text-rose-500",
    overlay: "from-rose-900/60 to-transparent",
  },
};

export function PagePreview({
  subdomain,
  customDomain,
  domainStatus,
  theme,
  heroTitle,
  heroSubtitle,
  heroImageUrl,
  isPublished,
  isPublishing,
  onPublish,
}: PagePreviewProps) {
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const styles = themeStyles[theme] || themeStyles["urban-cafe"];
  
  // Determine which URL to show in the address bar
  const hasActiveCustomDomain = customDomain && domainStatus === "active";
  const displayUrl = hasActiveCustomDomain 
    ? customDomain 
    : subdomain 
      ? `${subdomain}.matbex.com` 
      : "your-site.matbex.com";

  const primaryUrl = hasActiveCustomDomain 
    ? `https://${customDomain}` 
    : subdomain 
      ? `https://${subdomain}.matbex.com`
      : null;

  return (
    <Card className="sticky top-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Live Preview
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "desktop" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("desktop")}
            >
              <Monitor className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "mobile" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("mobile")}
            >
              <Smartphone className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview Frame */}
        <div className={cn(
          "relative rounded-lg overflow-hidden border-4 border-muted transition-all duration-300 mx-auto",
          viewMode === "desktop" ? "w-full aspect-video" : "w-48 aspect-[9/16]"
        )}>
          {/* Browser Chrome */}
          <div className="absolute top-0 inset-x-0 h-6 bg-muted flex items-center gap-1.5 px-2 z-10">
            <div className="h-2 w-2 rounded-full bg-red-400" />
            <div className="h-2 w-2 rounded-full bg-yellow-400" />
            <div className="h-2 w-2 rounded-full bg-green-400" />
            <div className="flex-1 mx-2">
              <div className="h-3 bg-background rounded text-[8px] flex items-center justify-center text-muted-foreground gap-1">
                {hasActiveCustomDomain && <Globe2 className="h-2 w-2" />}
                <span className="truncate">{displayUrl}</span>
              </div>
            </div>
          </div>

          {/* Page Content */}
          <div className={cn(
            "absolute inset-0 pt-6",
            styles.bg
          )}>
            {/* Hero Section */}
            <div className="relative h-full">
              {heroImageUrl && (
                <img
                  src={heroImageUrl}
                  alt="Hero"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className={cn(
                "absolute inset-0 bg-gradient-to-t",
                styles.overlay
              )} />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                <h1 className={cn(
                  "font-bold mb-2",
                  viewMode === "desktop" ? "text-2xl" : "text-sm",
                  heroImageUrl ? "text-white" : styles.text,
                  theme === "fine-diner" && "font-serif"
                )}>
                  {heroTitle || "Your Restaurant Name"}
                </h1>
                <p className={cn(
                  "opacity-80",
                  viewMode === "desktop" ? "text-sm" : "text-[8px]",
                  heroImageUrl ? "text-white" : styles.text
                )}>
                  {heroSubtitle || "Your tagline goes here"}
                </p>
                <div className={cn(
                  "mt-4 px-4 py-1.5 rounded-full font-medium",
                  viewMode === "desktop" ? "text-xs" : "text-[6px] px-2 py-0.5",
                  theme === "fine-diner" ? "bg-amber-500 text-zinc-900" :
                  theme === "urban-cafe" ? "bg-emerald-600 text-white" :
                  theme === "rustic-bistro" ? "bg-orange-600 text-white" :
                  theme === "modern-minimal" ? "bg-black text-white" :
                  "bg-rose-500 text-white"
                )}>
                  View Menu
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* URLs Section */}
        {(subdomain || hasActiveCustomDomain) && (
          <div className="space-y-2 text-xs">
            {subdomain && (
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-muted-foreground">Subdomain:</span>
                <a 
                  href={`https://${subdomain}.matbex.com`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {subdomain}.matbex.com
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            {hasActiveCustomDomain && (
              <div className="flex items-center justify-between p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-emerald-600 font-medium flex items-center gap-1">
                  <Globe2 className="h-3 w-3" />
                  Custom Domain:
                </span>
                <a 
                  href={`https://${customDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline flex items-center gap-1 font-medium"
                >
                  {customDomain}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Publish Status */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {isPublished ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                Published
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted">
                Draft
              </Badge>
            )}
          </div>
          <Button
            onClick={onPublish}
            disabled={isPublishing || !subdomain}
            size="sm"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              "Publish Changes"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
