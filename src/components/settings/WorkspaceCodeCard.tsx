import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Loader2, QrCode, RefreshCw, HelpCircle, ChevronDown, ChevronUp, Smartphone, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Settings card that surfaces the tenant slug as the "Workspace code"
 * cashiers enter to pair a POS device to this workspace.
 * Owners can generate one if missing.
 */
export function WorkspaceCodeCard() {
  const { tenant, hasRole, refreshAuth } = useAuth() as any;
  const canManage = hasRole("owner") || hasRole("manager");

  const [slug, setSlug] = useState(tenant?.slug ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Guided checklist state — persisted per workspace so progress survives reloads.
  const checklistStorageKey = tenant?.id
    ? `matbex.pairingChecklist.${tenant.id}`
    : "matbex.pairingChecklist.default";
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(checklistStorageKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [checklistStorageKey]);
  const toggleStep = (id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(checklistStorageKey, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };
  const resetChecklist = () => {
    setChecked({});
    try {
      localStorage.removeItem(checklistStorageKey);
    } catch {
      /* noop */
    }
  };

  // Deep-link support: /settings?tab=security&focus=workspace-code
  useEffect(() => {
    if (searchParams.get("focus") !== "workspace-code") return;
    const el = document.getElementById("workspace-code");
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlight(true);
        window.setTimeout(() => setHighlight(false), 2400);
      });
    }
    // Clean the param so the highlight doesn't retrigger on tab changes.
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setSlug(tenant?.slug ?? "");
  }, [tenant?.slug]);

  const suggested = useMemo(
    () => (tenant?.name ? slugify(tenant.name) : ""),
    [tenant?.name],
  );

  const onCopy = async () => {
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(slug);
      setCopied(true);
      toast.success("Workspace code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const startEditing = () => {
    setDraft(slug || suggested);
    setEditing(true);
  };

  const save = async () => {
    const clean = slugify(draft);
    if (clean.length < 3) {
      toast.error("Code must be at least 3 characters");
      return;
    }
    if (!tenant?.id) return;
    setSaving(true);
    try {
      const { data: conflict } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", clean)
        .neq("id", tenant.id)
        .maybeSingle();
      if (conflict) {
        toast.error(`"${clean}" is already taken`);
        return;
      }
      const { error } = await supabase
        .from("tenants")
        .update({ slug: clean })
        .eq("id", tenant.id);
      if (error) throw error;
      setSlug(clean);
      setEditing(false);
      toast.success("Workspace code saved");
      try { await refreshAuth?.(); } catch { /* noop */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save code");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      id="workspace-code"
      className={cn(
        "scroll-mt-24 transition-shadow duration-500",
        highlight && "ring-2 ring-primary shadow-lg",
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <QrCode className="h-4 w-4 text-primary" />
          Workspace code
        </CardTitle>
        <CardDescription>
          Cashiers enter this short code to pair their POS device to this workspace.
          Share it only with trusted staff.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <div className="space-y-2">
            <Label htmlFor="workspace-code-input">New workspace code</Label>
            <div className="flex gap-2">
              <Input
                id="workspace-code-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={suggested || "my-restaurant"}
                autoFocus
              />
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers and dashes only. Will be saved as{" "}
              <span className="font-mono">{slugify(draft) || "-"}</span>.
            </p>
          </div>
        ) : slug ? (
          <div className="grid gap-4 sm:grid-cols-[auto,1fr] items-start">
            <div className="flex justify-center sm:justify-start">
              <div className="p-3 rounded-xl bg-white border shadow-sm">
                <QRCodeSVG value={slug} size={144} level="M" includeMargin={false} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Pairing code
              </Label>
              <div className="flex items-center gap-2">
                <Input value={slug} readOnly className="font-mono text-base" />
                <Button variant="outline" onClick={() => void onCopy()} title="Copy code">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                {canManage && (
                  <Button variant="ghost" onClick={startEditing} title="Change code">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Smartphone className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                Scan the QR from the Android POS pairing screen, or type the
                code manually. Rotate it if it ever leaks.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-amber-600">
              No workspace code set yet. Cashiers cannot pair devices until one is generated.
            </p>
            {canManage ? (
              <Button onClick={startEditing}>Generate code</Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an owner or manager to generate one.
              </p>
            )}
          </div>
        )}

        {/* Troubleshooting */}
        <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <HelpCircle className="h-4 w-4 text-primary" />
                Can't pair? Troubleshoot
              </span>
              {helpOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <PairingChecklist
              checked={checked}
              onToggle={toggleStep}
              onReset={resetChecklist}
            />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

interface ChecklistStep {
  id: string;
  title: string;
  detail: React.ReactNode;
}

const PAIRING_STEPS: ChecklistStep[] = [
  {
    id: "code-generated",
    title: "Workspace code is generated",
    detail: (
      <>
        If the card above shows a code and QR, this step is done. Otherwise ask
        an owner or manager to generate one — cashiers can't create it.
      </>
    ),
  },
  {
    id: "device-online",
    title: "POS device is online",
    detail: (
      <>
        Confirm Wi-Fi or mobile data on the Android device. Pairing calls the
        server and won't work offline.
      </>
    ),
  },
  {
    id: "apk-updated",
    title: "Matbex APK is up to date",
    detail: (
      <>
        Older builds can't reach the pairing endpoint. Reinstall the latest APK
        if you see "Failed to send request".
      </>
    ),
  },
  {
    id: "open-pair-screen",
    title: "Opened the pairing screen on the device",
    detail: (
      <>
        Launch Matbex on the POS. You should see the "Pair this device" screen
        with a code field and a "Scan Workspace QR" button.
      </>
    ),
  },
  {
    id: "entered-code",
    title: "Scanned the QR or typed the code",
    detail: (
      <>
        Tap <span className="font-medium">Scan Workspace QR</span> and point the
        camera at the QR above, or type the code in{" "}
        <em>lowercase</em> with no spaces.
      </>
    ),
  },
  {
    id: "revoked-old",
    title: "Revoked any old device (if reusing hardware)",
    detail: (
      <>
        Open <span className="font-mono">POS Terminals</span> and remove the
        previous pairing before pairing the same device again.
      </>
    ),
  },
  {
    id: "signed-in",
    title: "Cashier signed in on the device",
    detail: (
      <>
        After pairing succeeds, the cashier signs in with their normal email
        and password. Pairing links the device — not the user.
      </>
    ),
  },
];

function PairingChecklist({
  checked,
  onToggle,
  onReset,
}: {
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const total = PAIRING_STEPS.length;
  const done = PAIRING_STEPS.filter((s) => checked[s.id]).length;
  const percent = Math.round((done / total) * 100);
  const complete = done === total;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {done} of {total} steps complete
          </span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>

      <ul className="space-y-2">
        {PAIRING_STEPS.map((step, idx) => {
          const isChecked = !!checked[step.id];
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 transition-colors",
                isChecked ? "bg-primary/5 border-primary/30" : "bg-background",
              )}
            >
              <Checkbox
                id={`pair-step-${step.id}`}
                checked={isChecked}
                onCheckedChange={() => onToggle(step.id)}
                className="mt-0.5"
              />
              <div className="space-y-1 min-w-0">
                <label
                  htmlFor={`pair-step-${step.id}`}
                  className={cn(
                    "text-sm font-medium cursor-pointer flex items-center gap-2",
                    isChecked && "text-muted-foreground line-through",
                  )}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {step.title}
                </label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {complete && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary flex items-center gap-2">
          <Check className="h-4 w-4" />
          All steps complete — the device should be paired and ready.
        </div>
      )}
    </div>
  );
}