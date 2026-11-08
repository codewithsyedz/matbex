import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Banknote,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Settings2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { hardwareManager } from "@/lib/hardware";
import { useHardwareConfig } from "@/hooks/useHardware";
import { ReceiptHistoryList } from "@/components/pos/ReceiptHistoryList";

type DrawerStatus = "unknown" | "ready" | "opening" | "ok" | "error";

interface Props {
  size?: "sm" | "lg";
}

export function CashDrawerControl({ size = "lg" }: Props) {
  const { config } = useHardwareConfig();
  const [status, setStatus] = useState<DrawerStatus>("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);

  // Initial readiness probe based on selected transport
  useEffect(() => {
    if (config.drawerTransport === "printer") {
      setStatus(config.defaultPrinterId ? "ready" : "unknown");
    } else if (config.drawerTransport === "serial") {
      const supported =
        typeof navigator !== "undefined" && "serial" in navigator;
      setStatus(supported ? "ready" : "error");
      if (!supported) setLastError("Web Serial not supported in this browser");
    } else {
      setStatus("ready");
    }
  }, [config.drawerTransport, config.defaultPrinterId]);

  const kick = useCallback(async (label: "Open" | "Test" | "Shortcut") => {
    setStatus("opening");
    setLastError(null);
    try {
      const ok = await hardwareManager.openDrawer();
      if (ok) {
        setStatus("ok");
        setLastAt(new Date().toLocaleTimeString());
        toast.success(
          label === "Test"
            ? "Drawer test successful"
            : label === "Shortcut"
              ? "Cash drawer opened (⌃⇧O)"
              : "Cash drawer opened",
        );
      } else {
        setStatus("error");
        setLastError("Drawer did not respond");
        toast.warning("Drawer did not respond - check connection");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Drawer error";
      setStatus("error");
      setLastError(msg);
      toast.error(msg);
    }
  }, []);

  // Global shortcut: Ctrl+Shift+O (or Cmd+Shift+O on macOS) opens drawer.
  // Ignored when typing in form fields so it doesn't fight with text input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT";
      if (isEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        void kick("Shortcut");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kick]);

  const meta = (() => {
    switch (status) {
      case "ok":
        return { Icon: CheckCircle2, tone: "text-emerald-500", label: "Connected" };
      case "ready":
        return { Icon: CheckCircle2, tone: "text-emerald-500", label: "Ready" };
      case "opening":
        return { Icon: Loader2, tone: "text-primary animate-spin", label: "Opening…" };
      case "error":
        return { Icon: AlertTriangle, tone: "text-destructive", label: "Error" };
      default:
        return { Icon: AlertTriangle, tone: "text-amber-500", label: "Not configured" };
    }
  })();

  const StatusIcon = meta.Icon;

  return (
    <div className="inline-flex items-center rounded-md border bg-background overflow-hidden">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={size}
            className="gap-2 rounded-none"
            onClick={() => void kick("Open")}
            disabled={status === "opening"}
          >
            <Banknote className="h-4 w-4 md:h-5 md:w-5" />
            <span className="hidden sm:inline">Open Drawer</span>
            <Badge
              variant="outline"
              className="ml-1 gap-1 px-1.5 py-0 h-5 text-[10px] font-normal"
            >
              <StatusIcon className={`h-3 w-3 ${meta.tone}`} />
              <span className="hidden md:inline">{meta.label}</span>
            </Badge>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-0.5 text-xs">
            <p className="font-medium">Cash drawer · {config.drawerTransport}</p>
            <p className="text-muted-foreground">Status: {meta.label}</p>
            {lastAt && <p className="text-muted-foreground">Last kick: {lastAt}</p>}
            {lastError && <p className="text-destructive">{lastError}</p>}
            <p className="text-muted-foreground pt-1">
              Shortcut:{" "}
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                ⌘/Ctrl + ⇧ + O
              </kbd>
            </p>
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="h-6 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={size}
            className="rounded-none px-2"
            aria-label="Drawer test & diagnostics"
          >
            <Zap className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Drawer connection</p>
            <p className="text-xs text-muted-foreground">
              Transport: <span className="font-mono">{config.drawerTransport}</span>
              {config.drawerTransport === "printer" && config.defaultPrinterName && (
                <> · via {config.defaultPrinterName}</>
              )}
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <StatusIcon className={`h-3.5 w-3.5 ${meta.tone}`} />
              <span>{meta.label}</span>
              {lastAt && <span className="text-muted-foreground">· {lastAt}</span>}
            </div>
            {lastError && (
              <p className="text-xs text-destructive">{lastError}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 gap-1.5"
              onClick={() => void kick("Test")}
              disabled={status === "opening"}
            >
              {status === "opening" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Test kick
            </Button>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="gap-1.5"
            >
              <Link to="/settings?tab=hardware">
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </Link>
            </Button>
          </div>
          <div className="space-y-1.5 pt-1 border-t">
            <p className="text-xs font-medium pt-2">Reprint a recent receipt</p>
            <ReceiptHistoryList limit={5} emptyHint="No receipts printed yet today." />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}