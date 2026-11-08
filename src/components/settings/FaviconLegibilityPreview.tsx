import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SIZES = [16, 32, 64] as const;

interface FaviconLegibilityPreviewProps {
  /** Data URL or public URL of the icon to inspect. */
  url: string | null;
  /** Optional label shown under the heading (e.g. "Unsaved preview"). */
  caption?: string;
  className?: string;
}

/**
 * Renders the favicon at real browser sizes (16/32/64px) on light and dark
 * surfaces plus a simulated browser tab, so legibility can be confirmed
 * before saving.
 */
export function FaviconLegibilityPreview({ url, caption, className }: FaviconLegibilityPreviewProps) {
  if (!url) return null;

  return (
    <div className={cn("space-y-3 rounded-lg border border-border/40 p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Legibility check</Label>
        {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as const).map((surface) => (
          <div
            key={surface}
            className={cn(
              "rounded-md border border-border/50 p-3",
              surface === "light" ? "bg-background" : "bg-foreground",
            )}
          >
            <p
              className={cn(
                "text-[10px] uppercase tracking-wide mb-3",
                surface === "light" ? "text-muted-foreground" : "text-background/70",
              )}
            >
              {surface === "light" ? "Light surface" : "Dark surface"}
            </p>
            <div className="flex items-end gap-4">
              {SIZES.map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <img
                    src={url}
                    alt={`Favicon rendered at ${s} by ${s} pixels on a ${surface} background`}
                    width={s}
                    height={s}
                    style={{ width: s, height: s }}
                  />
                  <span
                    className={cn(
                      "text-[10px]",
                      surface === "light" ? "text-muted-foreground" : "text-background/70",
                    )}
                  >
                    {s}px
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Simulated browser tab at the real 16px tab size */}
      <div className="rounded-md border border-border/50 bg-muted/40 p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Browser tab</p>
        <div className="inline-flex items-center gap-2 rounded-t-md border border-border/60 border-b-0 bg-background px-3 py-1.5 max-w-[220px]">
          <img src={url} alt="Favicon as it appears in a browser tab" width={16} height={16} style={{ width: 16, height: 16 }} />
          <span className="text-xs truncate text-foreground/80">Matbex — Dashboard</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        16px is the real tab size — if the mark is unreadable there, increase padding or simplify the artwork.
      </p>
    </div>
  );
}
