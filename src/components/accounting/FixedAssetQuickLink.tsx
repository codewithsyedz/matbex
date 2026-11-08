import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, Check, ExternalLink, Link2, Loader2, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { useProjects, type ProjectPhase } from "@/hooks/useProjects";
import {
  CAPEX_HANDOFF_PARAM,
  startCapexHandoff,
  type CapexHandoffDraft,
} from "@/lib/capexHandoff";

const PHASES: { value: ProjectPhase; label: string; hint: string }[] = [
  { value: "acquisition", label: "Acquisition (ACQ)", hint: "Buying an existing outlet / business" },
  { value: "construction", label: "Construction (CIP)", hint: "Build-out capitalised as work in progress" },
  { value: "renovation", label: "Renovation (CIP)", hint: "Fit-out or refurbishment of an existing site" },
  { value: "equipment", label: "Equipment (CIP)", hint: "Kitchen / POS equipment purchases before go-live" },
  { value: "pre_opening", label: "Pre-opening", hint: "Costs incurred before the outlet opens" },
];

const slugCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12) || "CIP";

export interface CapexReference {
  projectId: string;
  projectName: string;
}

interface Props {
  /** Half-typed expense carried over to the register so nothing is retyped. */
  draft: CapexHandoffDraft;
  branchId?: string | null;
  /** Existing link, when the user already referenced a project / CIP entry. */
  linked?: CapexReference | null;
  onLink: (reference: CapexReference) => void;
  onUnlink: () => void;
  /** Called just before navigating away (used to close the expense dialog). */
  onNavigateAway?: () => void;
}

/**
 * Quick-link panel shown under the "fixed asset account on an expense" error.
 * Two ways out: create the purchase in the Fixed Asset Register (with the
 * expense prefilled), or reference an existing FA / CIP / acquisition cost
 * centre so the posting guard passes and the expense can be retried.
 */
export function FixedAssetQuickLink({
  draft,
  branchId,
  linked,
  onLink,
  onUnlink,
  onNavigateAway,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { format: money } = useCurrency();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    phase: "construction" as ProjectPhase,
  });

  const { projects, createProject } = useProjects();
  const { summaries } = useFixedAssets({ branchId: branchId ?? null });

  // Prefill the minimal create form from the blocked expense so nothing is retyped.
  useEffect(() => {
    if (!createOpen) return;
    const base = (draft.description ?? "").trim();
    setForm((prev) => ({
      ...prev,
      name: prev.name || base || "Capital work in progress",
      code: prev.code || slugCode(base || "CIP"),
    }));
  }, [createOpen, draft.description]);

  const submitCreate = async () => {
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    if (!name || !code) {
      toast.error("Give the entry a code and a name.");
      return;
    }
    try {
      const project: any = await createProject.mutateAsync({
        code,
        name,
        phase: form.phase,
        branchId: branchId ?? draft.branchId ?? null,
        totalBudget: Number(draft.amount ?? 0) || 0,
      });
      onLink({ projectId: project.id, projectName: `${project.code} · ${project.name}` });
      setCreateOpen(false);
      toast.success("Cost centre created — retry saving the expense to post it against it.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the entry");
    }
  };

  const term = search.trim().toLowerCase();
  const matchingProjects = useMemo(
    () =>
      (projects ?? []).filter(
        (p: any) =>
          p.status !== "cancelled" &&
          (!term ||
            `${p.code ?? ""} ${p.name ?? ""}`.toLowerCase().includes(term)),
      ),
    [projects, term],
  );
  const matchingAssets = useMemo(
    () =>
      (summaries ?? []).filter(
        (a: any) =>
          !term || `${a.asset_tag ?? ""} ${a.name ?? ""}`.toLowerCase().includes(term),
      ),
    [summaries, term],
  );

  const goToRegister = () => {
    const handoff = startCapexHandoff(draft, `${location.pathname}${location.search}`);
    onNavigateAway?.();
    navigate(`/accounting/fixed-assets?${CAPEX_HANDOFF_PARAM}=${encodeURIComponent(handoff.id)}`);
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Fix it in the Fixed Asset Register</p>
          <p className="text-xs text-muted-foreground">
            Capitalise the purchase properly, or point this expense at the FA / CIP / acquisition
            cost centre it belongs to and retry posting.
          </p>
        </div>
      </div>

      {linked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <Check className="h-4 w-4 text-primary" />
          <span className="text-xs">
            Linked to <span className="font-medium">{linked.projectName}</span> — save the expense
            again to post it against capital work in progress.
          </span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={onUnlink}>
            Remove link
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create FA / CIP / ACQ entry here
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Reference an existing FA / CIP / ACQ
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={goToRegister}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open Fixed Asset Register
          </Button>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[30rem]">
          <DialogHeader>
            <DialogTitle>Create the capital entry</DialogTitle>
            <DialogDescription>
              Only the essentials — the rest can be completed later in Projects. Once created, the
              expense is linked to it and you can retry posting straight away.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="capex-name">Entry name</Label>
              <Input
                id="capex-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Al-Wadi kitchen fit-out"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="capex-code">Code</Label>
                <Input
                  id="capex-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="CIP-01"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.phase}
                  onValueChange={(v) => setForm((f) => ({ ...f, phase: v as ProjectPhase }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {PHASES.find((p) => p.value === form.phase)?.hint}
              {draft.amount ? ` · Budget seeded with ${money(Number(draft.amount) || 0)}.` : ""}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitCreate} disabled={createProject.isPending}>
              {createProject.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create &amp; link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-[34rem]">
          <DialogHeader>
            <DialogTitle>Reference an existing entry</DialogTitle>
            <DialogDescription>
              Pick the project / CIP cost centre this spend belongs to. Linking it lets the expense
              post to the capital account. Existing assets are listed so you don't create a duplicate.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects or assets"
              className="pl-8"
            />
          </div>

          <Tabs defaultValue="projects">
            <TabsList className="w-full">
              <TabsTrigger value="projects" className="flex-1">
                Projects / CIP / ACQ
              </TabsTrigger>
              <TabsTrigger value="assets" className="flex-1">
                Registered assets
              </TabsTrigger>
            </TabsList>

            <TabsContent value="projects" className="mt-3">
              <ScrollArea className="h-64 pr-2">
                {matchingProjects.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No project or cost centre matches. Create the purchase in the register instead.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {matchingProjects.map((p: any) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onLink({ projectId: p.id, projectName: `${p.code} · ${p.name}` });
                          setPickerOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-md border p-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="text-sm">
                          <span className="font-medium">{p.code}</span> · {p.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {p.phase}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="assets" className="mt-3">
              <ScrollArea className="h-64 pr-2">
                {matchingAssets.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No asset matches that search.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {matchingAssets.map((a: any) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-md border p-2 text-sm"
                      >
                        <span>
                          <span className="font-medium">{a.name}</span>
                          {a.asset_tag && (
                            <span className="ml-1 text-xs text-muted-foreground">({a.asset_tag})</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          NBV {money(Number(a.netBookValue ?? 0))}
                        </span>
                      </div>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                      Already registered? Then this spend is either a later instalment (record it on
                      the asset) or a running cost — pick a 6000-6999 expense account instead.
                    </p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                setCreateOpen(true);
              }}
            >
              Create a new entry instead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
