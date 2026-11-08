import { useState } from "react";
import { Download, Paperclip, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  /** Storage path (may be prefixed with the bucket name) of the attached invoice. */
  path: string;
  /** Filename used when downloading. */
  fileName?: string;
  /** Compact ghost buttons for use inside card headers. */
  size?: "sm" | "default";
  showView?: boolean;
}

async function signedUrl(path: string) {
  const clean = path.replace("invoice-images/", "");
  const { data, error } = await supabase.storage.from("invoice-images").createSignedUrl(clean, 3600);
  if (error || !data) throw new Error(error?.message ?? "Could not read the invoice");
  return data.signedUrl;
}

export function InvoiceActions({ path, fileName, size = "sm", showView = true }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: (url: string) => Promise<void> | void) => {
    setBusy(key);
    try {
      const url = await signedUrl(path);
      await fn(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open the invoice");
    } finally {
      setBusy(null);
    }
  };

  const view = () =>
    run("view", (url) => {
      window.open(url, "_blank", "noopener");
    });

  const download = () =>
    run("download", async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not download the invoice");
      const blob = await res.blob();
      const ext = path.split(".").pop()?.split("?")[0] || "jpg";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${(fileName || "invoice").replace(/[^\w-]+/g, "-").toLowerCase()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    });

  const print = () =>
    run("print", (url) => {
      const isPdf = /\.pdf(\?|$)/i.test(path);
      const w = window.open("", "_blank", "noopener,width=900,height=1000");
      if (!w) {
        toast.error("Allow pop-ups to print the invoice");
        return;
      }
      const body = isPdf
        ? `<iframe src="${url}" onload="setTimeout(function(){window.focus();window.print();},400)"></iframe>`
        : `<img src="${url}" onload="setTimeout(function(){window.focus();window.print();},200)" />`;
      w.document.write(
        `<!doctype html><html><head><title>${fileName || "Invoice"}</title>` +
          `<style>html,body{margin:0;height:100%}img{max-width:100%;display:block;margin:0 auto}` +
          `iframe{border:0;width:100%;height:100%}@media print{@page{margin:10mm}}</style></head>` +
          `<body>${body}</body></html>`,
      );
      w.document.close();
    });

  const cls = size === "sm" ? "h-7 px-2" : "";

  return (
    <div className="flex items-center gap-1">
      {showView && (
        <Button size={size} variant="ghost" className={cls} onClick={view} disabled={busy === "view"}>
          <Paperclip className="h-3.5 w-3.5 mr-1" />
          View invoice
        </Button>
      )}
      <Button
        size={size}
        variant="ghost"
        className={cls}
        onClick={download}
        disabled={busy === "download"}
        title="Download invoice"
      >
        <Download className="h-3.5 w-3.5 mr-1" />
        Download
      </Button>
      <Button
        size={size}
        variant="ghost"
        className={cls}
        onClick={print}
        disabled={busy === "print"}
        title="Print invoice"
      >
        <Printer className="h-3.5 w-3.5 mr-1" />
        Print
      </Button>
    </div>
  );
}
