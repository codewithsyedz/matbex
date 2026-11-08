import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, ClipboardList, Copy, Check, ExternalLink, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

/**
 * Mobile Cockpit handoff card.
 * Renders a QR code pointing at /cockpit on the current origin so the owner
 * can scan it with their phone and add it to their home screen.
 */
// Always use the canonical production domain for QR/share links so owners
// landing from their phone are not stuck on a preview URL.
const CANONICAL_ORIGIN = "https://www.matbex.com";

export function MobileCockpitCard() {
  const [copied, setCopied] = useState<string | null>(null);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const cockpitUrl = `${CANONICAL_ORIGIN}/cockpit`;
  const summaryUrl = `${CANONICAL_ORIGIN}/end-of-day-summary`;
  const posBackfillUrl = `${CANONICAL_ORIGIN}/pos-backfill`;

  const copy = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      toast.success("Link copied");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <div className="p-5 rounded-lg border bg-card space-y-5">
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-md bg-accent text-accent-foreground">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">Mobile Cockpit</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scan with your phone to open the live owner cockpit. Add it to your
            home screen for one-tap access during service.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-[auto,1fr] gap-6 items-center">
        <div className="flex justify-center md:justify-start">
          {cockpitUrl ? (
            <div className="p-3 rounded-xl bg-white border shadow-sm">
              <QRCodeSVG
                value={cockpitUrl}
                size={176}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="h-[200px] w-[200px] rounded-xl bg-muted animate-pulse" />
          )}
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cockpit
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-2 py-1.5 rounded bg-muted truncate">
                {cockpitUrl || "-"}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copy(cockpitUrl, "cockpit")}
                disabled={!cockpitUrl}
                aria-label="Copy cockpit link"
              >
                {copied === "cockpit" ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                asChild
                disabled={!cockpitUrl}
                aria-label="Open cockpit"
              >
                <a href={cockpitUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                End-of-Day Summary
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-2 py-1.5 rounded bg-muted truncate">
                {summaryUrl || "-"}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copy(summaryUrl, "summary")}
                disabled={!summaryUrl}
                aria-label="Copy end-of-day summary link"
              >
                {copied === "summary" ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                asChild
                disabled={!summaryUrl}
                aria-label="Open end-of-day summary"
              >
                <a href={summaryUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Today: <span className="font-mono">/cockpit/summary/{today}</span>
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                POS Backfill
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-2 py-1.5 rounded bg-muted truncate">
                {posBackfillUrl}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copy(posBackfillUrl, "pos-backfill")}
                aria-label="Copy POS backfill link"
              >
                {copied === "pos-backfill" ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                asChild
                aria-label="Open POS backfill"
              >
                <a href={posBackfillUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Reconcile past sales from POS exports.
            </p>
          </div>

          <div className="text-xs text-muted-foreground border-t pt-3">
            <strong className="text-foreground">Tip:</strong> on iPhone tap{" "}
            <em>Share → Add to Home Screen</em>; on Android tap the menu →{" "}
            <em>Add to Home screen</em>.
          </div>
        </div>
      </div>
    </div>
  );
}