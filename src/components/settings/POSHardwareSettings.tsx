import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Printer, ChefHat, Banknote, Settings2, TestTube, Loader2, CreditCard, Globe, Monitor, Usb, Wine, FileText, ReceiptText, ScrollText } from "lucide-react";
import { hardwareManager } from "@/lib/hardware/manager";
import { usePOSHardware, POSHardwareSettings as HardwareSettings } from "@/hooks/usePOSHardware";
import { queueReceiptPrint, generateKitchenOrderHTML, openCashDrawerViaSerial, printViaBrowser } from "@/lib/printUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ReceiptTemplatesManager } from "@/components/settings/ReceiptTemplatesManager";
import { POSLayoutPicker } from "@/components/settings/POSLayoutPicker";
import type { PosLayoutTemplate } from "@/components/pos/POSAlternateLayouts";
import type { ReceiptTemplate } from "@/hooks/useReceiptTemplates";

export function POSHardwareSettings() {
  const { settings, isLoading, updateSettings, isUpdating } = usePOSHardware();
  
  // Initialize local settings from effective settings (which have defaults)
  const [localSettings, setLocalSettings] = useState<Partial<HardwareSettings>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Always sync from settings when available
    if (settings) {
      setLocalSettings({
        receipt_printer_enabled: settings.receipt_printer_enabled,
        receipt_printer_type: settings.receipt_printer_type,
        receipt_printer_ip: settings.receipt_printer_ip,
        receipt_printer_port: settings.receipt_printer_port,
        receipt_printer_name: settings.receipt_printer_name,
        receipt_header: settings.receipt_header,
        receipt_footer: settings.receipt_footer,
        print_receipt_on_sale: settings.print_receipt_on_sale,
        receipt_template: settings.receipt_template,
        kitchen_printer_enabled: settings.kitchen_printer_enabled,
        kitchen_printer_type: settings.kitchen_printer_type,
        kitchen_printer_ip: settings.kitchen_printer_ip,
        kitchen_printer_port: settings.kitchen_printer_port,
        kitchen_printer_name: settings.kitchen_printer_name,
        print_kitchen_on_sale: settings.print_kitchen_on_sale,
        bar_printer_enabled: settings.bar_printer_enabled,
        bar_printer_type: settings.bar_printer_type,
        bar_printer_ip: settings.bar_printer_ip,
        bar_printer_port: settings.bar_printer_port,
        bar_printer_name: settings.bar_printer_name,
        print_bar_on_sale: settings.print_bar_on_sale,
        cash_drawer_enabled: settings.cash_drawer_enabled,
        cash_drawer_connection: settings.cash_drawer_connection,
        cash_drawer_auto_open_cash: settings.cash_drawer_auto_open_cash,
        cash_drawer_kick_code: settings.cash_drawer_kick_code,
        hala_enabled: settings.hala_enabled,
        hala_terminal_id: settings.hala_terminal_id,
        hala_mock_mode: settings.hala_mock_mode,
        hala_approve_probability: settings.hala_approve_probability,
        ext_pos_enabled: settings.ext_pos_enabled,
        ext_pos_provider_name: settings.ext_pos_provider_name,
        ext_pos_base_url: settings.ext_pos_base_url,
        ext_pos_charge_path: settings.ext_pos_charge_path,
        ext_pos_auth_type: settings.ext_pos_auth_type,
        ext_pos_api_key_header: settings.ext_pos_api_key_header,
        ext_pos_api_key: settings.ext_pos_api_key,
        ext_pos_bearer_token: settings.ext_pos_bearer_token,
        ext_pos_basic_username: settings.ext_pos_basic_username,
        ext_pos_basic_password: settings.ext_pos_basic_password,
        ext_pos_oauth_client_id: settings.ext_pos_oauth_client_id,
        ext_pos_oauth_client_secret: settings.ext_pos_oauth_client_secret,
        ext_pos_oauth_token_url: settings.ext_pos_oauth_token_url,
        ext_pos_oauth_scope: settings.ext_pos_oauth_scope,
        pos_layout_template: settings.pos_layout_template,
        pos_layout_config: settings.pos_layout_config,
      } as Partial<HardwareSettings>);
      setIsInitialized(true);
    }
  }, [settings]);

  const handleChange = <K extends keyof HardwareSettings>(key: K, value: HardwareSettings[K]) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
  };

  const handleSave = () => {
    console.log("Saving POS settings:", localSettings);
    updateSettings(localSettings);
  };

  const testReceiptPrint = async (
    lang: "en" | "ar" = "ar",
    template?: ReceiptTemplate | null,
  ) => {
    const isAr = lang === "ar";
    const job = await queueReceiptPrint(
      {
        restaurantName: isAr ? "مطعم الاختبار" : "Test Restaurant",
        receiptNumber: isAr ? "TEST-AR-001" : "TEST-EN-001",
        date: new Date(),
        items: isAr
          ? [
              { name: "اختبار صنف 1", quantity: 2, price: 10, total: 20 },
              { name: "اختبار صنف 2", size: "كبير", quantity: 1, price: 15, total: 15 },
            ]
          : [
              { name: "Test Item 1", quantity: 2, price: 10, total: 20 },
              { name: "Test Item 2", size: "Large", quantity: 1, price: 15, total: 15 },
            ],
        subtotal: 35,
        tax: 0,
        total: 35,
        paymentMethod: isAr ? "نقدي" : "Cash",
        header:
          template?.[isAr ? "header_note_ar" : "header_note_en"] ||
          localSettings.receipt_header ||
          (isAr ? "اختبار الطباعة العربية" : "Test print — English"),
        footer:
          template?.[isAr ? "footer_note_ar" : "footer_note_en"] ||
          localSettings.receipt_footer ||
          (isAr
            ? "يجب أن يظهر هذا السطر بالعربية بدون علامات استفهام"
            : "Thank you — this is a printer test"),
      },
      {
        receiptPrinterType: localSettings.receipt_printer_type ?? "browser",
        receiptPrinterIp: localSettings.receipt_printer_ip || undefined,
        receiptPrinterPort: localSettings.receipt_printer_port || 9100,
        openDrawer:
          !!localSettings.cash_drawer_enabled &&
          (localSettings.cash_drawer_auto_open_cash ?? true),
        drawerKickCode: localSettings.cash_drawer_kick_code,
        template: (template?.preset ?? localSettings.receipt_template ?? "tax_invoice") as
          | "simple" | "tax_invoice" | "detailed" | "saudi_bilingual" | "zatca_standard",
        templateConfig: template
          ? {
              language: template.language,
              paperWidth: template.paper_width,
              options: template.options as Record<string, boolean | string | number | null>,
              headerNoteEn: template.header_note_en,
              headerNoteAr: template.header_note_ar,
              footerNoteEn: template.footer_note_en,
              footerNoteAr: template.footer_note_ar,
            }
          : undefined,
      },
    );
    const result = await hardwareManager.waitForJobCompletion(job.id, 8000);
    if (result?.status === "done") {
      toast.success(isAr ? "Arabic test receipt printed" : "English test receipt printed");
      return;
    }
    if (result?.status === "failed") {
      toast.error(result.lastError || "Test print failed");
      return;
    }
    toast.info("Test receipt queued and still trying to print");
  };

  const testKitchenPrint = () => {
    const testOrder = generateKitchenOrderHTML({
      orderNumber: "K-001",
      date: new Date(),
      items: [
        { name: "Burger", size: "Large", quantity: 2, notes: "No onions" },
        { name: "Fries", quantity: 2 },
        { name: "Drink", size: "Medium", quantity: 2 },
      ],
      priority: "normal",
    });
    void printViaBrowser(testOrder)
      .then(() => toast.success("Test kitchen order sent to printer"))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Kitchen test print failed");
      });
  };

  const testCashDrawer = async () => {
    try {
      const ok = await hardwareManager.openDrawer();
      if (ok) {
        toast.success("Cash drawer kicked");
      } else {
        toast.warning("Drawer did not respond — check key position and RJ11 cable");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drawer kick failed");
    }
  };

  const testHalaCharge = async () => {
    toast.info("Sending 1.00 SAR test charge to Hala terminal...");
    try {
      const { data, error } = await supabase.functions.invoke("charge-hala-card", {
        body: {
          amount: 1,
          currency: "SAR",
          terminalId: localSettings.hala_terminal_id ?? null,
          receiptNumber: `TEST-${Date.now()}`,
          mock: localSettings.hala_mock_mode ?? true,
          approveProbability: localSettings.hala_approve_probability ?? 0.9,
        },
      });
      if (error) throw error;
      if (data?.status === "approved") {
        toast.success(`Hala approved · Ref ${data.reference}`);
      } else if (data?.status === "declined") {
        toast.warning(`Hala declined: ${data.message ?? ""}`);
      } else {
        toast.error(data?.message ?? "Unknown response from Hala");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test charge failed");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* HP ap5000 (and similar Windows all-in-one POS) preset */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Monitor className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                HP ap5000 Preset
                <Badge variant="secondary" className="text-xs">All-in-one POS</Badge>
              </CardTitle>
              <CardDescription>
                One-click setup for the HP ap5000 (Windows, 1024×768 touchscreen, USB/serial ESC/POS receipt printer + RJ11 cash drawer). Works fully offline.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
            <li>Install <strong>QZ Tray</strong> on the ap5000 (one-time), then share the receipt printer to Windows.</li>
            <li>Click <em>Apply HP ap5000 preset</em> below to configure the printer + drawer kick.</li>
            <li>Open <strong>Record Sale</strong> in Chrome/Edge fullscreen (F11) - works offline; sales sync when network returns.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                const preset: Partial<HardwareSettings> = {
                  receipt_printer_enabled: true,
                  receipt_printer_type: "network",
                  receipt_printer_ip: localSettings.receipt_printer_ip || "192.168.1.100",
                  receipt_printer_port: 9100,
                  receipt_printer_name: localSettings.receipt_printer_name || "HP ap5000 Receipt",
                  print_receipt_on_sale: true,
                  cash_drawer_enabled: true,
                  cash_drawer_connection: "printer",
                  cash_drawer_auto_open_cash: true,
                  // Standard ESC/POS drawer kick (ESC p 0 25 250) - works with most
                  // receipt printers shipped with the HP ap5000.
                  cash_drawer_kick_code: "27,112,0,25,250",
                };
                setLocalSettings((prev) => ({ ...prev, ...preset }));
                updateSettings(preset);
                toast.success("HP ap5000 preset applied. Set the printer IP if it isn't 192.168.1.100.");
              }}
              disabled={isUpdating}
            >
              Apply HP ap5000 preset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open("https://qz.io/download/", "_blank", "noopener")}
            >
              Download QZ Tray
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Local Print Agent (Windows USB) preset */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                Local Print Agent
                <Badge variant="secondary" className="text-xs">Windows · USB · Arabic-safe</Badge>
              </CardTitle>
              <CardDescription>
                Runs the Matbex print service on the POS machine. The browser sends receipt JSON to
                <code className="px-1">http://127.0.0.1:9911/print</code> — the agent rasterises Arabic
                and pushes raw ESC/POS bytes to the USB printer. No print dialog. No font issues.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
            <li>On the POS machine, run <code>cd print-agent &amp;&amp; npm install &amp;&amp; npm start</code>.</li>
            <li>(Optional) Run <code>install-windows-service.bat</code> to start the agent on boot.</li>
            <li>Click <em>Apply Local Print Agent preset</em>, then <em>Check agent status</em>.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                const preset: Partial<HardwareSettings> = {
                  receipt_printer_enabled: true,
                  receipt_printer_type: "local-agent",
                  receipt_printer_ip: localSettings.receipt_printer_ip || "127.0.0.1",
                  receipt_printer_port: 9911,
                  receipt_printer_name: localSettings.receipt_printer_name || "Local Print Agent",
                  print_receipt_on_sale: true,
                  cash_drawer_enabled: true,
                  cash_drawer_connection: "printer",
                  cash_drawer_auto_open_cash: true,
                  cash_drawer_kick_code: "27,112,0,25,250",
                };
                setLocalSettings((prev) => ({ ...prev, ...preset }));
                updateSettings(preset);
                hardwareManager.updateConfig({
                  preferredTransport: "local-agent",
                  networkHost: "127.0.0.1",
                  networkPort: 9911,
                  drawerTransport: "printer",
                  drawerKickCode: "27,112,0,25,250",
                  autoOpenDrawerOnCash: true,
                });
                toast.success("Local Print Agent preset applied.");
              }}
              disabled={isUpdating}
            >
              Apply Local Print Agent preset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const host = localSettings.receipt_printer_ip || "127.0.0.1";
                const port = localSettings.receipt_printer_port || 9911;
                try {
                  const res = await fetch(`http://${host}:${port}/health`);
                  if (!res.ok) throw new Error(`agent responded ${res.status}`);
                  const data = await res.json().catch(() => ({}));
                  toast.success(
                    `Agent reachable at ${host}:${port}${data?.version ? ` · v${data.version}` : ""}`,
                  );
                } catch (e) {
                  toast.error(
                    e instanceof Error
                      ? `Agent unreachable at ${host}:${port} — ${e.message}`
                      : "Agent unreachable",
                  );
                }
              }}
            >
              <TestTube className="h-4 w-4 mr-2" />
              Check agent status
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TA-900U / Android USB-OTG preset (kept for legacy direct-OTG setups) */}
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
                Plug the TA-900U directly into your Android tablet/phone via USB-OTG. Prints customer receipts, kitchen tickets and kicks the cash drawer through the printer's RJ11 port.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
            <li>Install the <strong>Matbex Android app</strong> (Capacitor build) on the device - see <code>docs/thermal-printer-ta900u.md</code>.</li>
            <li>Connect the TA-900U via the supplied USB-OTG cable. Tap <em>Allow</em> when Android asks for USB permission.</li>
            <li>Click <em>Apply TA-900U preset</em>, then <em>Detect USB printer</em> to confirm the device is visible.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                const preset: Partial<HardwareSettings> = {
                  receipt_printer_enabled: true,
                  receipt_printer_type: "usb",
                  receipt_printer_name: localSettings.receipt_printer_name || "TA-900U",
                  print_receipt_on_sale: true,
                  kitchen_printer_enabled: true,
                  kitchen_printer_type: "usb",
                  kitchen_printer_name: localSettings.kitchen_printer_name || "TA-900U Kitchen",
                  print_kitchen_on_sale: true,
                  cash_drawer_enabled: true,
                  cash_drawer_connection: "printer",
                  cash_drawer_auto_open_cash: true,
                  // Standard ESC/POS kick (ESC p 0 25 250) - TA-900U RJ11 default
                  cash_drawer_kick_code: "27,112,0,25,250",
                };
                setLocalSettings((prev) => ({ ...prev, ...preset }));
                updateSettings(preset);
                hardwareManager.updateConfig({
                  preferredTransport: "usb",
                  defaultPrinterName: "TA-900U",
                  drawerTransport: "printer",
                  drawerKickCode: "27,112,0,25,250",
                  autoOpenDrawerOnCash: true,
                });
                toast.success("TA-900U preset applied. Connect the printer via USB-OTG and tap Detect.");
              }}
              disabled={isUpdating}
            >
              Apply TA-900U preset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  hardwareManager.updateConfig({ preferredTransport: "usb" });
                  const list = await hardwareManager.detectPrinters();
                  if (list.length === 0) {
                    toast.warning("No USB printer detected. Confirm OTG cable + Android USB permission.");
                  } else {
                    const names = list.map((p) => p.name).join(", ");
                    toast.success(`USB printer found: ${names}`);
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "USB detection failed");
                }
              }}
            >
              <TestTube className="h-4 w-4 mr-2" />
              Detect USB printer
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  const opened = await hardwareManager.openDrawer();
                  if (opened) toast.success("Cash drawer kick sent");
                  else toast.info("Drawer not opened - check connection.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Drawer kick failed");
                }
              }}
            >
              <Banknote className="h-4 w-4 mr-2" />
              Test drawer kick
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Receipt Printer */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Printer className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Receipt Printer</CardTitle>
                <CardDescription>Print customer receipts after sales</CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.receipt_printer_enabled ?? false}
              onCheckedChange={(v) => handleChange("receipt_printer_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.receipt_printer_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection Type</Label>
                <Select
                  value={localSettings.receipt_printer_type ?? "browser"}
                  onValueChange={(v) => handleChange("receipt_printer_type", v as HardwareSettings["receipt_printer_type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser">
                      <div className="flex items-center gap-2">
                        Browser Print
                        <Badge variant="secondary" className="text-xs">Recommended</Badge>
                      </div>
                    </SelectItem>
                    <SelectItem value="network">Network/IP Printer</SelectItem>
                    <SelectItem value="bluetooth">Bluetooth</SelectItem>
                    <SelectItem value="usb">
                      <div className="flex items-center gap-2">
                        USB (Android OTG)
                        <Badge variant="secondary" className="text-xs">TA-900U</Badge>
                      </div>
                    </SelectItem>
                    <SelectItem value="local-agent">
                      <div className="flex items-center gap-2">
                        Local Print Agent
                        <Badge variant="secondary" className="text-xs">Windows · USB</Badge>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(localSettings.receipt_printer_type === "network" ||
                localSettings.receipt_printer_type === "local-agent") && (
                <>
                  <div className="space-y-2">
                    <Label>
                      {localSettings.receipt_printer_type === "local-agent"
                        ? "Agent Host"
                        : "Printer IP Address"}
                    </Label>
                    <Input
                      placeholder={
                        localSettings.receipt_printer_type === "local-agent"
                          ? "127.0.0.1"
                          : "192.168.1.100"
                      }
                      value={localSettings.receipt_printer_ip || ""}
                      onChange={(e) => handleChange("receipt_printer_ip", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      placeholder={
                        localSettings.receipt_printer_type === "local-agent" ? "9911" : "9100"
                      }
                      value={
                        localSettings.receipt_printer_port ||
                        (localSettings.receipt_printer_type === "local-agent" ? 9911 : 9100)
                      }
                      onChange={(e) => handleChange("receipt_printer_port", parseInt(e.target.value))}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Printer Name (Optional)</Label>
                <Input
                  placeholder="Main Receipt Printer"
                  value={localSettings.receipt_printer_name || ""}
                  onChange={(e) => handleChange("receipt_printer_name", e.target.value)}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Receipt Header</Label>
                <Textarea
                  placeholder="Add custom header text (e.g., address, phone number)"
                  value={localSettings.receipt_header || ""}
                  onChange={(e) => handleChange("receipt_header", e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Receipt Footer</Label>
                <Textarea
                  placeholder="Add custom footer text (e.g., thank you message, return policy)"
                  value={localSettings.receipt_footer || ""}
                  onChange={(e) => handleChange("receipt_footer", e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-print-receipt"
                  checked={localSettings.print_receipt_on_sale ?? true}
                  onCheckedChange={(v) => handleChange("print_receipt_on_sale", v)}
                />
                <Label htmlFor="auto-print-receipt" className="text-sm font-normal">
                  Auto-print receipt on sale
                </Label>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => testReceiptPrint("en")}>
                  <TestTube className="h-4 w-4 mr-2" />
                  Test (EN)
                </Button>
                <Button variant="outline" size="sm" onClick={() => testReceiptPrint("ar")}>
                  <TestTube className="h-4 w-4 mr-2" />
                  اختبار (AR)
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Receipt Templates — full CRUD with bilingual + ZATCA Standard presets */}
      <ReceiptTemplatesManager
        onTestPrint={(tpl, lang) => {
          void testReceiptPrint(lang, tpl);
        }}
      />

      {/* POS Screen Layout (Record Sale UI) */}
      <POSLayoutPicker
        value={(localSettings.pos_layout_template ?? settings.pos_layout_template ?? "classic_dense") as PosLayoutTemplate}
        onChange={(v) => {
          handleChange("pos_layout_template" as keyof HardwareSettings, v);
          updateSettings({ pos_layout_template: v });
        }}
        config={(localSettings as { pos_layout_config?: HardwareSettings["pos_layout_config"] }).pos_layout_config ?? settings.pos_layout_config ?? {}}
        onConfigChange={(cfg) => {
          handleChange("pos_layout_config" as keyof HardwareSettings, cfg as never);
          updateSettings({ pos_layout_config: cfg } as Partial<HardwareSettings>);
        }}
      />

      {/* Kitchen Printer */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <ChefHat className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Kitchen Printer</CardTitle>
                <CardDescription>Send orders to kitchen display or printer</CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.kitchen_printer_enabled ?? false}
              onCheckedChange={(v) => handleChange("kitchen_printer_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.kitchen_printer_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection Type</Label>
                <Select
                  value={localSettings.kitchen_printer_type ?? "browser"}
                  onValueChange={(v) => handleChange("kitchen_printer_type", v as HardwareSettings["kitchen_printer_type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser">Browser Print</SelectItem>
                    <SelectItem value="network">Network/IP Printer</SelectItem>
                    <SelectItem value="bluetooth">Bluetooth</SelectItem>
                    <SelectItem value="usb">USB (Android OTG · TA-900U)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {localSettings.kitchen_printer_type === "network" && (
                <>
                  <div className="space-y-2">
                    <Label>Printer IP Address</Label>
                    <Input
                      placeholder="192.168.1.101"
                      value={localSettings.kitchen_printer_ip || ""}
                      onChange={(e) => handleChange("kitchen_printer_ip", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      placeholder="9100"
                      value={localSettings.kitchen_printer_port || 9100}
                      onChange={(e) => handleChange("kitchen_printer_port", parseInt(e.target.value))}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Printer Name (Optional)</Label>
                <Input
                  placeholder="Kitchen Printer"
                  value={localSettings.kitchen_printer_name || ""}
                  onChange={(e) => handleChange("kitchen_printer_name", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-print-kitchen"
                  checked={localSettings.print_kitchen_on_sale ?? true}
                  onCheckedChange={(v) => handleChange("print_kitchen_on_sale", v)}
                />
                <Label htmlFor="auto-print-kitchen" className="text-sm font-normal">
                  Auto-print kitchen order on sale
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={testKitchenPrint}>
                <TestTube className="h-4 w-4 mr-2" />
                Test Print
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Bar Printer (drinks routing) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Wine className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Bar Printer</CardTitle>
                <CardDescription>
                  Drinks &amp; bar items (those flagged <b>Bar</b> on the menu) print here instead of the kitchen.
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.bar_printer_enabled ?? false}
              onCheckedChange={(v) => handleChange("bar_printer_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.bar_printer_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection Type</Label>
                <Select
                  value={localSettings.bar_printer_type ?? "browser"}
                  onValueChange={(v) => handleChange("bar_printer_type", v as HardwareSettings["bar_printer_type"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser">Browser Print</SelectItem>
                    <SelectItem value="network">Network/IP Printer</SelectItem>
                    <SelectItem value="bluetooth">Bluetooth</SelectItem>
                    <SelectItem value="usb">USB</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {localSettings.bar_printer_type === "network" && (
                <>
                  <div className="space-y-2">
                    <Label>Printer IP Address</Label>
                    <Input
                      placeholder="192.168.1.102"
                      value={localSettings.bar_printer_ip || ""}
                      onChange={(e) => handleChange("bar_printer_ip", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      placeholder="9100"
                      value={localSettings.bar_printer_port || 9100}
                      onChange={(e) => handleChange("bar_printer_port", parseInt(e.target.value))}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Printer Name (Optional)</Label>
                <Input
                  placeholder="Bar Printer"
                  value={localSettings.bar_printer_name || ""}
                  onChange={(e) => handleChange("bar_printer_name", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-print-bar"
                  checked={localSettings.print_bar_on_sale ?? true}
                  onCheckedChange={(v) => handleChange("print_bar_on_sale", v)}
                />
                <Label htmlFor="auto-print-bar" className="text-sm font-normal">
                  Auto-print bar ticket on sale
                </Label>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Cash Drawer */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Banknote className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Cash Drawer</CardTitle>
                <CardDescription>Automatically open drawer on cash payments</CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.cash_drawer_enabled ?? false}
              onCheckedChange={(v) => handleChange("cash_drawer_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.cash_drawer_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection Method</Label>
                <Select
                  value={localSettings.cash_drawer_connection ?? "printer"}
                  onValueChange={(v) => handleChange("cash_drawer_connection", v as HardwareSettings["cash_drawer_connection"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="printer">
                      <div className="flex items-center gap-2">
                        Via Receipt Printer
                        <Badge variant="secondary" className="text-xs">Common</Badge>
                      </div>
                    </SelectItem>
                    <SelectItem value="serial">Direct Serial/USB</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Most cash drawers connect to the receipt printer and open when a receipt prints.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Drawer Kick Code (ESC/POS)</Label>
                <Input
                  placeholder="27,112,0,25,250"
                  value={localSettings.cash_drawer_kick_code || "27,112,0,25,250"}
                  onChange={(e) => handleChange("cash_drawer_kick_code", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Standard ESC/POS command. Only change if drawer doesn't open.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-open-drawer"
                  checked={localSettings.cash_drawer_auto_open_cash ?? true}
                  onCheckedChange={(v) => handleChange("cash_drawer_auto_open_cash", v)}
                />
                <Label htmlFor="auto-open-drawer" className="text-sm font-normal">
                  Auto-open on cash payments
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={testCashDrawer}>
                <TestTube className="h-4 w-4 mr-2" />
                Test Drawer
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Hala POS Card Terminal */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  Hala POS Card Terminal
                  <Badge variant="secondary" className="text-xs">Scaffold</Badge>
                </CardTitle>
                <CardDescription>
                  Push card sales directly to your Hala payment device
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.hala_enabled ?? false}
              onCheckedChange={(v) => handleChange("hala_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.hala_enabled && (
          <CardContent className="space-y-4">
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Live Hala API credentials are not yet provisioned. Mock mode simulates
              an approval response so you can test the full sale flow end-to-end.
              Once you receive your Hala API key & terminal ID, switch off mock mode
              and we'll wire the real endpoint.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Terminal ID</Label>
                <Input
                  placeholder="e.g. HALA-T-00123"
                  value={localSettings.hala_terminal_id || ""}
                  onChange={(e) => handleChange("hala_terminal_id", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Found on the back of the device or in your Hala merchant portal.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Mode</Label>
                <div className="flex items-center gap-2 h-10 px-3 rounded-md border">
                  <Switch
                    id="hala-mock-mode"
                    checked={localSettings.hala_mock_mode ?? true}
                    onCheckedChange={(v) => handleChange("hala_mock_mode", v)}
                  />
                  <Label htmlFor="hala-mock-mode" className="text-sm font-normal">
                    Mock mode (simulate approvals)
                  </Label>
                </div>
              </div>
            </div>

            {localSettings.hala_mock_mode && (
              <div className="space-y-2">
                <Label>Mock approve probability ({Math.round((localSettings.hala_approve_probability ?? 0.9) * 100)}%)</Label>
                <Input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={localSettings.hala_approve_probability ?? 0.9}
                  onChange={(e) => handleChange("hala_approve_probability", parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Lets you test the declined-card path. 100% = always approve.
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={testHalaCharge}>
                <TestTube className="h-4 w-4 mr-2" />
                Send 1.00 test charge
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* External POS REST Integration (generic card-charger provider) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  External POS REST Integration
                  <Badge variant="secondary" className="text-xs">Generic</Badge>
                </CardTitle>
                <CardDescription>
                  Configure any card-charger provider that exposes a REST API
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={localSettings.ext_pos_enabled ?? false}
              onCheckedChange={(v) => handleChange("ext_pos_enabled", v)}
            />
          </div>
        </CardHeader>
        {localSettings.ext_pos_enabled && (
          <CardContent className="space-y-4">
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              These credentials are stored on your restaurant's settings only and used
              by the server-side charge function. Configure the provider here, then
              we'll wire the actual call when you're ready.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider name</Label>
                <Input
                  placeholder="e.g. Hala, Geidea, Network International"
                  value={localSettings.ext_pos_provider_name || ""}
                  onChange={(e) => handleChange("ext_pos_provider_name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input
                  placeholder="https://api.provider.com"
                  value={localSettings.ext_pos_base_url || ""}
                  onChange={(e) => handleChange("ext_pos_base_url", e.target.value)}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Charge endpoint path</Label>
                <Input
                  placeholder="/v1/charges"
                  value={localSettings.ext_pos_charge_path || ""}
                  onChange={(e) => handleChange("ext_pos_charge_path", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Appended to the Base URL when sending a charge.
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Authorization type</Label>
              <Select
                value={localSettings.ext_pos_auth_type ?? "api_key"}
                onValueChange={(v) => handleChange("ext_pos_auth_type", v as HardwareSettings["ext_pos_auth_type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                  <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {localSettings.ext_pos_auth_type === "api_key" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Header name</Label>
                  <Input
                    placeholder="X-API-Key"
                    value={localSettings.ext_pos_api_key_header || ""}
                    onChange={(e) => handleChange("ext_pos_api_key_header", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>API key</Label>
                  <Input
                    type="password"
                    placeholder="••••••••••••"
                    value={localSettings.ext_pos_api_key || ""}
                    onChange={(e) => handleChange("ext_pos_api_key", e.target.value)}
                  />
                </div>
              </div>
            )}

            {localSettings.ext_pos_auth_type === "bearer" && (
              <div className="space-y-2">
                <Label>Bearer token</Label>
                <Input
                  type="password"
                  placeholder="eyJhbGciOi…"
                  value={localSettings.ext_pos_bearer_token || ""}
                  onChange={(e) => handleChange("ext_pos_bearer_token", e.target.value)}
                />
              </div>
            )}

            {localSettings.ext_pos_auth_type === "basic" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    placeholder="merchant_user"
                    value={localSettings.ext_pos_basic_username || ""}
                    onChange={(e) => handleChange("ext_pos_basic_username", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={localSettings.ext_pos_basic_password || ""}
                    onChange={(e) => handleChange("ext_pos_basic_password", e.target.value)}
                  />
                </div>
              </div>
            )}

            {localSettings.ext_pos_auth_type === "oauth2" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={localSettings.ext_pos_oauth_client_id || ""}
                    onChange={(e) => handleChange("ext_pos_oauth_client_id", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client secret</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={localSettings.ext_pos_oauth_client_secret || ""}
                    onChange={(e) => handleChange("ext_pos_oauth_client_secret", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Token URL</Label>
                  <Input
                    placeholder="https://api.provider.com/oauth/token"
                    value={localSettings.ext_pos_oauth_token_url || ""}
                    onChange={(e) => handleChange("ext_pos_oauth_token_url", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scope (optional)</Label>
                  <Input
                    placeholder="payments.write"
                    value={localSettings.ext_pos_oauth_scope || ""}
                    onChange={(e) => handleChange("ext_pos_oauth_scope", e.target.value)}
                  />
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Save Button - Always visible for manual save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isUpdating}>
          {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
