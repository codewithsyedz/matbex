import { useState } from "react";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHARE_EXPIRY_OPTIONS, type ShareableLink } from "@/hooks/useShareableReportLink";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: ShareableLink | null;
  /** Title used in the mail subject line. */
  documentTitle: string;
  busy?: boolean;
  /** Re-signs the same uploaded file with a new validity window. */
  onChangeExpiry: (seconds: number) => void;
}

/**
 * Presents a time-limited signed link for a generated report so it can be sent
 * to an accountant or auditor without downloading the file.
 */
export function ShareReportLinkDialog({
  open,
  onOpenChange,
  link,
  documentTitle,
  busy,
  onChangeExpiry,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const mailto = link
    ? `mailto:?subject=${encodeURIComponent(documentTitle)}&body=${encodeURIComponent(
        `${documentTitle}\n\nSecure link (expires ${link.expiresAt.toLocaleString()}):\n${link.url}\n`,
      )}`
    : "#";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Shareable link
          </DialogTitle>
          <DialogDescription>
            The PDF is stored privately. Anyone with this link can open it until it expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="share-url">Link</Label>
            <div className="flex gap-2">
              <Input id="share-url" readOnly value={link?.url ?? ""} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={copy} disabled={!link || busy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Expires in</Label>
            <Select
              value={String(link?.expiresInSeconds ?? 604800)}
              onValueChange={(v) => onChangeExpiry(Number(v))}
              disabled={!link || busy}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {link ? (
              <p className="text-xs font-light text-muted-foreground">
                Valid until {link.expiresAt.toLocaleString()}.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline" disabled={!link}>
            <a href={mailto}>
              <Mail className="mr-2 h-4 w-4" /> Send by email
            </a>
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
