import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useToast } from "@/hooks/use-toast";
import { getTerminalId, regenerateTerminalId } from "@/lib/offline/terminal";
import { persistSyncCredentials } from "@/lib/offline/backgroundSync";
import { ensureOfflineBootstrapped } from "@/lib/offline/lazyBootstrap";
import { Pencil, RefreshCw, Ban, RotateCcw, Monitor, Plus, Smartphone, Copy } from "lucide-react";
import { Usb, Printer, Banknote, TestTube } from "lucide-react";
import { hardwareManager } from "@/lib/hardware/manager";
import { WebUSBPrinterAdapter } from "@/lib/hardware/adapters/webusbAdapter";
import { usePOSHardware } from "@/hooks/usePOSHardware";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { StaffPinManager } from "@/components/pos/StaffPinManager";

interface PosTerminal {
  id: string;
  restaurant_id: string;
  terminal_uid: string;
  name: string;
  branch_label: string | null;
  registered_by: string | null;
  last_seen_at: string | null;
  user_agent: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export default function PosTerminals() {
  const { restaurant, hasRole, user } = useAuth();
  const isAdmin = hasRole("owner") || hasRole("manager");
  const { toast } = useToast();
  const navigate = useNavigate();
  const { updateSettings, isUpdating } = usePOSHardware();
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [thisDeviceUid, setThisDeviceUid] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<PosTerminal | null>(null);
  const [renameValue, setRenameValue] = useState({ name: "", branch_label: "" });
  const [revokeTarget, setRevokeTarget] = useState<PosTerminal | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({ name: "", branch_label: "" });
  const [busy, setBusy] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingForm, setPairingForm] = useState({ name: "", branch_label: "" });
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expires_at: string } | null>(null);

  useEffect(() => {
    // Managing terminals implies the user wants offline POS - boot the
    // engine so background sync registration & credentials are primed.
    void ensureOfflineBootstrapped(restaurant?.id ?? null);
    void getTerminalId().then(setThisDeviceUid);
  }, [restaurant?.id]);

  const refresh = async () => {
    if (!restaurant?.id) return;
    setLoading(true);
    const { data, error } = await db
      .from("pos_terminals")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("last_seen_at", { ascending: false, nullsFirst: false });
    if (error) {
      toast({ title: "Could not load terminals", description: error.message, variant: "destructive" });
    } else {
      setTerminals((data ?? []) as PosTerminal[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id]);

  const grouped = useMemo(
    () => ({
      active: terminals.filter((t) => t.active),
      revoked: terminals.filter((t) => !t.active),
    }),
    [terminals],
  );

  if (!isAdmin) {
    return (
      <>
        <LockedFeatureScreen
          featureName="POS Terminal Management"
          description="Only owners and managers can manage point-of-sale terminals."
        />
      </>
    );
  }

  // ---- Actions ---------------------------------------------------------
  const handleRename = async () => {
    if (!renaming) return;
    setBusy(true);
    const { error } = await db
      .from("pos_terminals")
      .update({
        name: renameValue.name.trim() || "Unnamed terminal",
        branch_label: renameValue.branch_label.trim() || null,
      })
      .eq("id", renaming.id);
    setBusy(false);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }
    setRenaming(null);
    toast({ title: "Terminal updated" });
    await refresh();
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    const { error } = await db
      .from("pos_terminals")
      .update({ active: false })
      .eq("id", revokeTarget.id);
    setBusy(false);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      return;
    }
    setRevokeTarget(null);
    toast({
      title: "Terminal revoked",
      description: "It can no longer push offline transactions until re-registered.",
    });
    await refresh();
  };

  const handleReactivate = async (term: PosTerminal) => {
    const { error } = await db
      .from("pos_terminals")
      .update({ active: true })
      .eq("id", term.id);
    if (error) {
      toast({ title: "Re-activate failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Terminal re-activated" });
    await refresh();
  };

  const handleRegister = async () => {
    if (!restaurant?.id) return;
    setBusy(true);
    const tid = thisDeviceUid ?? (await getTerminalId());
    const { error } = await db.from("pos_terminals").upsert(
      {
        restaurant_id: restaurant.id,
        terminal_uid: tid,
        name: registerForm.name.trim() || "This device",
        branch_label: registerForm.branch_label.trim() || null,
        registered_by: user?.id ?? null,
        active: true,
        user_agent: navigator.userAgent,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,terminal_uid" },
    );
    setBusy(false);
    if (error) {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      return;
    }
    setRegisterOpen(false);
    setRegisterForm({ name: "", branch_label: "" });
    toast({ title: "Device registered" });
    await refresh();
  };

  /** Re-issue the local terminal UUID and register it fresh. Use after revocation. */
  const handleReRegisterThisDevice = async () => {
    if (!restaurant?.id) return;
    setBusy(true);
    const newId = await regenerateTerminalId();
    setThisDeviceUid(newId);
    await persistSyncCredentials({ branchId: restaurant.id, terminalId: newId });
    const { error } = await db.from("pos_terminals").insert({
      restaurant_id: restaurant.id,
      terminal_uid: newId,
      name: "This device (re-registered)",
      registered_by: user?.id ?? null,
      active: true,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Re-register failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "This device re-registered with a fresh ID" });
    await refresh();
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">POS Terminals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View, rename, revoke and re-register point-of-sale devices for{" "}
              <span className="font-medium text-foreground">{restaurant?.name}</span>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setGeneratedCode(null); setPairingForm({ name: "", branch_label: "" }); setPairingOpen(true); }}>
              <Smartphone className="h-4 w-4" /> Pair Android terminal
            </Button>
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              <Plus className="h-4 w-4" /> Register this device
            </Button>
          </div>
        </header>

        {isAdmin && <StaffPinManager />}



        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              Active terminals ({grouped.active.length})
            </CardTitle>
            <CardDescription>
              These devices are allowed to push offline POS transactions.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[420px]">
              <TerminalTable
                rows={grouped.active}
                thisDeviceUid={thisDeviceUid}
                onRename={(t) => {
                  setRenameValue({ name: t.name, branch_label: t.branch_label ?? "" });
                  setRenaming(t);
                }}
                onRevoke={(t) => setRevokeTarget(t)}
                emptyText="No active terminals yet. Register this device to get started."
              />
            </ScrollArea>
          </CardContent>
        </Card>

        {grouped.revoked.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">
                Revoked terminals ({grouped.revoked.length})
              </CardTitle>
              <CardDescription>
                Revoked devices cannot sync. Re-activate to restore access, or re-register this
                browser to issue a fresh terminal ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[280px]">
                <TerminalTable
                  rows={grouped.revoked}
                  thisDeviceUid={thisDeviceUid}
                  onRename={(t) => {
                    setRenameValue({ name: t.name, branch_label: t.branch_label ?? "" });
                    setRenaming(t);
                  }}
                  onReactivate={handleReactivate}
                  onReRegister={
                    grouped.revoked.some((t) => t.terminal_uid === thisDeviceUid)
                      ? handleReRegisterThisDevice
                      : undefined
                  }
                  emptyText="No revoked terminals."
                  isRevokedView
                />
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Tip: Revoking a terminal blocks future sync calls but does not delete past sales already
          recorded on the server.
        </p>

        {/* TA-900U Thermal Printer setup */}
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Usb className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  TA-900U Thermal Printer
                  <Badge variant="secondary" className="text-xs">Android · USB-OTG</Badge>
                </CardTitle>
                <CardDescription>
                  Plug the TA-900U into your Android terminal via USB-OTG. Prints customer
                  receipts, kitchen tickets, and kicks the cash drawer through the printer's RJ11
                  port. Requires the Matbex Android app.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Install the Matbex Android app on the device (see <code>docs/thermal-printer-ta900u.md</code>).</li>
              <li>Connect the TA-900U via the supplied USB-OTG cable. Tap <em>Allow</em> when Android asks for USB permission.</li>
              <li>Apply the preset, then <em>Detect</em> to confirm the printer is visible.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const preset = {
                    receipt_printer_enabled: true,
                    receipt_printer_type: "usb" as const,
                    receipt_printer_name: "TA-900U",
                    print_receipt_on_sale: true,
                    kitchen_printer_enabled: true,
                    kitchen_printer_type: "usb" as const,
                    kitchen_printer_name: "TA-900U Kitchen",
                    print_kitchen_on_sale: true,
                    cash_drawer_enabled: true,
                    cash_drawer_connection: "printer" as const,
                    cash_drawer_auto_open_cash: true,
                    cash_drawer_kick_code: "27,112,0,25,250",
                  };
                  updateSettings(preset);
                  hardwareManager.updateConfig({
                    preferredTransport: "usb",
                    defaultPrinterName: "TA-900U",
                    drawerTransport: "printer",
                    drawerKickCode: "27,112,0,25,250",
                    autoOpenDrawerOnCash: true,
                  });
                  toast({ title: "TA-900U preset applied", description: "Connect via USB-OTG, then tap Detect." });
                }}
                disabled={isUpdating}
              >
                <Printer className="h-4 w-4" /> Apply TA-900U preset
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    if (!Capacitor.isNativePlatform()) {
                      toast({
                        title: "Open the Matbex Android app",
                        description:
                          "USB-OTG printers can only be detected from the native Android app. The web preview cannot access USB devices.",
                      });
                      return;
                    }
                    hardwareManager.updateConfig({ preferredTransport: "usb" });
                    const list = await hardwareManager.detectPrinters();
                    if (list.length === 0) {
                      toast({
                        title: "No USB printer detected",
                        description: "Check the OTG cable and Android USB permission.",
                        variant: "destructive",
                      });
                    } else {
                      toast({ title: "USB printer found", description: list.map((p) => p.name).join(", ") });
                    }
                  } catch (e) {
                    toast({
                      title: "USB detection failed",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                  }
                }}
              >
                <TestTube className="h-4 w-4" /> Detect USB printer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    if (!Capacitor.isNativePlatform()) {
                      toast({
                        title: "Open the Matbex Android app",
                        description:
                          "The drawer kick fires through the TA-900U over USB-OTG, which only works from the native app.",
                      });
                      return;
                    }
                    const opened = await hardwareManager.openDrawer();
                    if (opened) toast({ title: "Cash drawer kick sent" });
                    else toast({ title: "Drawer not opened", description: "Check connection." });
                  } catch (e) {
                    toast({
                      title: "Drawer kick failed",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Banknote className="h-4 w-4" /> Test drawer kick
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Connect a printer directly from the web browser (no native app) */}
        <BrowserPrinterCard />
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename terminal</DialogTitle>
            <DialogDescription>
              Give this device a name your team will recognize.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Display name</label>
              <Input
                value={renameValue.name}
                onChange={(e) => setRenameValue((v) => ({ ...v, name: e.target.value }))}
                placeholder="e.g. Front counter iPad"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Branch label (optional)</label>
              <Input
                value={renameValue.branch_label}
                onChange={(e) => setRenameValue((v) => ({ ...v, branch_label: e.target.value }))}
                placeholder="e.g. Drive-thru"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={busy}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register-this-device dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register this device</DialogTitle>
            <DialogDescription>
              Claims terminal ID{" "}
              <span className="font-mono text-xs">{thisDeviceUid?.slice(0, 8) ?? "-"}</span> for{" "}
              {restaurant?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Display name</label>
              <Input
                value={registerForm.name}
                onChange={(e) => setRegisterForm((v) => ({ ...v, name: e.target.value }))}
                placeholder="e.g. Cashier 1"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Branch label (optional)</label>
              <Input
                value={registerForm.branch_label}
                onChange={(e) => setRegisterForm((v) => ({ ...v, branch_label: e.target.value }))}
                placeholder="e.g. Main hall"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={busy}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{revokeTarget?.name}</span> will be blocked from syncing
              new offline transactions until you re-activate or re-register it. Past server-recorded
              sales are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} disabled={busy}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pair Android terminal dialog */}
      <Dialog open={pairingOpen} onOpenChange={(o) => { setPairingOpen(o); if (!o) setGeneratedCode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair a new Android terminal</DialogTitle>
            <DialogDescription>
              Generate a one-time 6-digit code, then enter it on the Android POS app to bind that
              device to <span className="font-medium">{restaurant?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-primary/5 p-3 flex items-start gap-3">
            <KeyRound className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
            <div className="flex-1 text-xs">
              <p className="font-medium text-foreground">
                Prefer a permanent Workspace code + QR?
              </p>
              <p className="text-muted-foreground mt-0.5">
                Use your workspace's short slug + QR instead of a one-time code.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPairingOpen(false);
                navigate("/settings?tab=security&focus=workspace-code");
              }}
            >
              Show me
            </Button>
          </div>

          {!generatedCode ? (
            <>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Default name (optional)</label>
                  <Input
                    value={pairingForm.name}
                    onChange={(e) => setPairingForm((v) => ({ ...v, name: e.target.value }))}
                    placeholder="e.g. Counter 1 Tablet"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Branch label (optional)</label>
                  <Input
                    value={pairingForm.branch_label}
                    onChange={(e) => setPairingForm((v) => ({ ...v, branch_label: e.target.value }))}
                    placeholder="e.g. Drive-thru"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPairingOpen(false)}>Cancel</Button>
                <Button
                  onClick={async () => {
                    if (!restaurant?.id) return;
                    setBusy(true);
                    const { data, error } = await db.rpc("create_pairing_code", {
                      _restaurant_id: restaurant.id,
                      _default_name: pairingForm.name.trim() || null,
                      _default_branch_label: pairingForm.branch_label.trim() || null,
                      _ttl_minutes: 15,
                    });
                    setBusy(false);
                    if (error) {
                      toast({ title: "Could not generate code", description: error.message, variant: "destructive" });
                      return;
                    }
                    const row = (data as Array<{ code: string; expires_at: string }>)?.[0];
                    if (row) setGeneratedCode(row);
                  }}
                  disabled={busy}
                >
                  Generate code
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/40 p-6 text-center space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Pairing code</div>
                <div className="font-mono text-4xl font-light tracking-[0.5em]">{generatedCode.code}</div>
                <div className="text-xs text-muted-foreground">
                  Expires {new Date(generatedCode.expires_at).toLocaleTimeString()} - share only with the
                  Android device being paired.
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedCode.code);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <Copy className="h-4 w-4" /> Copy
                </Button>
                <Button onClick={() => setPairingOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TerminalTable({
  rows,
  thisDeviceUid,
  onRename,
  onRevoke,
  onReactivate,
  onReRegister,
  emptyText,
  isRevokedView,
}: {
  rows: PosTerminal[];
  thisDeviceUid: string | null;
  onRename: (t: PosTerminal) => void;
  onRevoke?: (t: PosTerminal) => void;
  onReactivate?: (t: PosTerminal) => void;
  onReRegister?: () => void;
  emptyText: string;
  isRevokedView?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background border-b">
        <tr className="text-left text-xs text-muted-foreground">
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Terminal ID</th>
          <th className="px-4 py-2">Last seen</th>
          <th className="px-4 py-2">Device</th>
          <th className="px-4 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const isThis = t.terminal_uid === thisDeviceUid;
          return (
            <tr key={t.id} className="border-b hover:bg-muted/40">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{t.name}</div>
                    {t.branch_label && (
                      <div className="text-xs text-muted-foreground">{t.branch_label}</div>
                    )}
                  </div>
                  {isThis && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      This device
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {t.terminal_uid.slice(0, 12)}…
              </td>
              <td className="px-4 py-3 text-xs">
                {t.last_seen_at
                  ? formatDistanceToNow(new Date(t.last_seen_at), { addSuffix: true })
                  : "Never"}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px] truncate">
                {t.user_agent ?? "-"}
              </td>
              <td className="px-4 py-3 text-right space-x-1">
                <Button size="sm" variant="ghost" onClick={() => onRename(t)}>
                  <Pencil className="h-4 w-4" /> Rename
                </Button>
                {isRevokedView ? (
                  <>
                    {onReactivate && (
                      <Button size="sm" variant="ghost" onClick={() => onReactivate(t)}>
                        <RotateCcw className="h-4 w-4" /> Re-activate
                      </Button>
                    )}
                    {isThis && onReRegister && (
                      <Button size="sm" onClick={onReRegister}>
                        Re-register
                      </Button>
                    )}
                  </>
                ) : (
                  onRevoke && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onRevoke(t)}
                    >
                      <Ban className="h-4 w-4" /> Revoke
                    </Button>
                  )
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------
// BrowserPrinterCard - pair an ESC/POS thermal printer directly from the
// browser via WebUSB (Chrome/Edge), or fall back to the OS print dialog.
// ---------------------------------------------------------------------
function BrowserPrinterCard() {
  const { toast } = useToast();
  const { updateSettings, isUpdating } = usePOSHardware();
  const [paired, setPaired] = useState<{ name: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const webusbSupported = typeof navigator !== "undefined" && "usb" in navigator;

  useEffect(() => {
    if (!webusbSupported) return;
    const adapter = new WebUSBPrinterAdapter();
    void adapter.listPrinters().then((list) => {
      if (list[0]) setPaired({ name: list[0].name, id: list[0].id });
    });
  }, [webusbSupported]);

  const handlePair = async (showAll = false) => {
    setBusy(true);
    try {
      const adapter = new WebUSBPrinterAdapter();
      const desc = await adapter.requestDevice(showAll);
      if (!desc) return;
      setPaired({ name: desc.name, id: desc.id });
      hardwareManager.updateConfig({
        preferredTransport: "webusb",
        defaultPrinterId: desc.id,
        defaultPrinterName: desc.name,
        drawerTransport: "printer",
      });
      updateSettings({
        receipt_printer_enabled: true,
        receipt_printer_type: "usb",
        receipt_printer_name: desc.name,
        print_receipt_on_sale: true,
      });
      toast({ title: "Printer paired", description: desc.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // User cancelling the chooser throws NotFoundError - swallow that.
      if (msg.toLowerCase().includes("no device selected")) return;
      toast({ title: "Pairing failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleTestPrint = async () => {
    setBusy(true);
    try {
      const adapter = new WebUSBPrinterAdapter();
      await adapter.printReceipt(null, {
        receiptNumber: `TEST-${Date.now().toString().slice(-5)}`,
        restaurantName: "Matbex Test Print",
        date: new Date().toISOString(),
        items: [{ name: "Test item", quantity: 1, unitPrice: 0, total: 0 }],
        subtotal: 0,
        tax: 0,
        total: 0,
        paymentMethod: "Cash",
        footer: "Web browser print successful.",
      });
      toast({ title: "Test receipt sent" });
    } catch (e) {
      toast({
        title: "Print failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBrowserDialog = () => {
    hardwareManager.updateConfig({ preferredTransport: "browser" });
    updateSettings({
      receipt_printer_enabled: true,
      receipt_printer_type: "browser",
      receipt_printer_name: "Browser print dialog",
      print_receipt_on_sale: true,
    });
    toast({
      title: "Browser print dialog enabled",
      description: "Receipts will open the OS print dialog. Works with any printer your computer can see.",
    });
  };

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Printer className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              Connect printer via Web Browser
              <Badge variant="secondary" className="text-xs">No app required</Badge>
            </CardTitle>
            <CardDescription>
              Pair an ESC/POS thermal printer (TA-900U, Epson, Xprinter, Bixolon, Star…) directly
              from Chrome or Edge using WebUSB. Or fall back to the OS print dialog for any
              installed printer.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">WebUSB:</span>
            {webusbSupported ? (
              paired ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
                  Paired · {paired.name}
                </Badge>
              ) : (
                <Badge variant="outline">Supported · not paired</Badge>
              )
            ) : (
              <Badge variant="destructive">Not supported in this browser</Badge>
            )}
          </div>
          {!webusbSupported && (
            <p className="text-xs text-muted-foreground">
              WebUSB requires Chrome, Edge, or Opera on desktop. Safari and Firefox don't support
              it — use the browser print dialog below instead.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => handlePair(false)}
              disabled={!webusbSupported || busy || isUpdating}
            >
              <Usb className="h-4 w-4" /> {paired ? "Re-pair USB printer" : "Pair USB printer"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => handlePair(true)}
              disabled={!webusbSupported || busy || isUpdating}
              title="Use this if your printer didn't appear in the first picker (off-list VID)."
            >
              Show all USB devices
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleTestPrint}
              disabled={!paired || busy}
            >
              <TestTube className="h-4 w-4" /> Test print
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            If Chrome says <em>"No compatible devices found"</em>, click <strong>Show all USB devices</strong>
            and pick the printer from the full list — most TA-900U clones use an unbranded vendor ID we
            can't filter for in advance.
          </p>
        </div>

        <div className="pt-3 border-t border-border/40 space-y-2">
          <div className="text-sm font-medium">Or use the OS print dialog</div>
          <p className="text-xs text-muted-foreground">
            Works with any printer your computer is already set up with (USB, network, AirPrint,
            shared). Opens a browser print preview for every sale instead of a silent thermal cut.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={handleBrowserDialog} disabled={isUpdating}>
            <Printer className="h-4 w-4" /> Use browser print dialog
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}