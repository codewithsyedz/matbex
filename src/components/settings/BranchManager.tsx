import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Pencil, Archive, Star, Search, Power, PowerOff, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { useFunnelTracker } from "@/hooks/useFunnelTracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Branch {
  id: string;
  restaurant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  vat_rate: number | string | null;
  prices_vat_inclusive?: boolean | null;
  is_primary: boolean;
  is_active: boolean;
  deleted_at: string | null;
}

interface BranchFormState {
  name: string;
  code: string;
  address: string;
  country: string;
  city: string;
  phone: string;
  vatRate: string;
  pricesVatInclusive: boolean;
}

const EMPTY_FORM: BranchFormState = { name: "", code: "", address: "", country: "", city: "", phone: "", vatRate: "15", pricesVatInclusive: true };

export function BranchManager() {
  const { restaurant, hasRole } = useAuth();
  const qc = useQueryClient();
  const canEdit = hasRole("owner") || hasRole("manager");
  const restaurantId = restaurant?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [archiveTarget, setArchiveTarget] = useState<Branch | null>(null);
  const [archiving, setArchiving] = useState(false);

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as Branch[];
      const { data, error } = await db
        .from("branches" as any)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("is_primary", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Branch[];
    },
    enabled: !!restaurantId,
  });

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return branches.filter((b) => {
      if (statusFilter === "active" && !b.is_active) return false;
      if (statusFilter === "inactive" && b.is_active) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.code?.toLowerCase().includes(q) ?? false) ||
        (b.address?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [branches, searchQuery, statusFilter]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditing(b);
    setForm({
      name: b.name,
      code: b.code ?? "",
      address: b.address ?? "",
      country: b.country ?? "",
      city: b.city ?? "",
      phone: b.phone ?? "",
      vatRate: b.vat_rate == null ? "15" : String(b.vat_rate),
      pricesVatInclusive: b.prices_vat_inclusive ?? true,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!restaurantId) return;
    if (!form.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    const vatRateNum = parseFloat(form.vatRate);
    if (!isFinite(vatRateNum) || vatRateNum < 0 || vatRateNum > 100) {
      toast.error("VAT rate must be a number between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        address: form.address.trim() || null,
        country: form.country.trim() || null,
        city: form.city.trim() || null,
        phone: form.phone.trim() || null,
        vat_rate: vatRateNum,
        prices_vat_inclusive: form.pricesVatInclusive,
      };
      if (editing) {
        const { error } = await db
          .from("branches" as any)
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Branch updated");
      } else {
        const { error } = await db
          .from("branches" as any)
          .insert({ ...payload, restaurant_id: restaurantId });
        if (error) throw error;
        toast.success("Branch created");
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["branches", restaurantId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save branch");
    } finally {
      setSaving(false);
    }
  };

  const requestArchive = (b: Branch) => {
    if (b.is_primary) {
      toast.error("The primary branch cannot be archived");
      return;
    }
    setArchiveTarget(b);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const { error } = await db
        .from("branches" as any)
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", archiveTarget.id);
      if (error) throw error;
      toast.success("Branch archived");
      qc.invalidateQueries({ queryKey: ["branches", restaurantId] });
      setArchiveTarget(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to archive branch");
    } finally {
      setArchiving(false);
    }
  };

  const toggleActive = async (b: Branch) => {
    if (b.is_primary && b.is_active) {
      toast.error("The primary branch cannot be deactivated");
      return;
    }
    const { error } = await db
      .from("branches" as any)
      .update({ is_active: !b.is_active })
      .eq("id", b.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(b.is_active ? "Branch deactivated" : "Branch activated");
    qc.invalidateQueries({ queryKey: ["branches", restaurantId] });
  };

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-accent text-accent-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">Branches</h3>
            <p className="text-sm text-muted-foreground">
              Manage physical locations under this account. New sales, shifts,
              cash events, inventory, and expenses are automatically stamped
              with the active branch and the dashboard now respects the
              selected branch.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild className="gap-2">
            <Link to="/branch-settings">
              <Settings2 className="h-4 w-4" /> Branch settings
            </Link>
          </Button>
          {canEdit && <AddBranchButton openNew={openNew} />}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, or address…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground ml-auto">
          {filteredBranches.length} of {branches.length}
        </div>
      </div>

      <div className="divide-y border rounded-md">
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading branches…</div>
        )}
        {!isLoading && branches.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No branches yet.</div>
        )}
        {!isLoading && branches.length > 0 && filteredBranches.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No branches match the current filters.
          </div>
        )}
        {filteredBranches.map((b) => (
          <div
            key={b.id}
            className="p-4 flex items-center justify-between gap-3 flex-wrap"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground truncate">
                  {b.name}
                </span>
                {b.code && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {b.code}
                  </Badge>
                )}
                {b.is_primary && (
                  <Badge className="gap-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
                    <Star className="h-3 w-3" /> Primary
                  </Badge>
                )}
                {!b.is_active && (
                  <Badge variant="secondary" className="text-[10px]">
                    Inactive
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {[
                  b.address,
                  b.phone,
                  `VAT ${b.vat_rate ?? 15}% ${(b.prices_vat_inclusive ?? true) ? "incl." : "excl."}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(b)}
                  className="gap-1"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                {!b.is_primary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(b)}
                    className="gap-1"
                  >
                    {b.is_active ? (
                      <>
                        <PowerOff className="h-3.5 w-3.5" /> Deactivate
                      </>
                    ) : (
                      <>
                        <Power className="h-3.5 w-3.5" /> Activate
                      </>
                    )}
                  </Button>
                )}
                {!b.is_primary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => requestArchive(b)}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit branch" : "Add branch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="branch-name">Name</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jeddah - Tahlia"
              />
            </div>
            <div>
              <Label htmlFor="branch-code">Short code</Label>
              <Input
                id="branch-code"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="JED-01"
                maxLength={16}
              />
            </div>
            <div>
              <Label htmlFor="branch-address">Address</Label>
              <Input
                id="branch-address"
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="branch-country">Country</Label>
                <Input
                  id="branch-country"
                  value={form.country}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, country: e.target.value }))
                  }
                  placeholder="Saudi Arabia"
                />
              </div>
              <div>
                <Label htmlFor="branch-city">City</Label>
                <Input
                  id="branch-city"
                  value={form.city}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, city: e.target.value }))
                  }
                  placeholder="Riyadh"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="branch-phone">Phone</Label>
                <Input
                  id="branch-phone"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="branch-vat">VAT rate (%)</Label>
                <Input
                  id="branch-vat"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.vatRate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, vatRate: e.target.value }))
                  }
                  placeholder="15"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Used for POS pricing and ZATCA invoices.
                </p>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="branch-price-mode">Prices include VAT</Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {form.pricesVatInclusive
                      ? "Menu prices are what the guest pays — VAT is backed out of the listed price."
                      : "Menu prices are net — VAT is added on top at checkout."}
                  </p>
                </div>
                <Switch
                  id="branch-price-mode"
                  checked={form.pricesVatInclusive}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, pricesVatInclusive: v }))
                  }
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Changing this does not rewrite historical receipts — past sales keep
                the totals they were recorded with. It only affects how new sales are
                priced and displayed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {archiveTarget?.name}
              </span>{" "}
              will be hidden from active lists and marked inactive. Existing
              records (sales, shifts, expenses) keep their reference. This can't
              be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmArchive();
              }}
              disabled={archiving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {archiving ? "Archiving…" : "Archive branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddBranchButton({ openNew }: { openNew: () => void }) {
  const { isDemo, maxBranches } = useDemoTrial();
  const { track } = useFunnelTracker();
  const handle = () => {
    if (isDemo) track("branch_attempted", { max_branches: maxBranches });
    openNew();
  };
  return (
    <Button size="sm" onClick={handle} className="gap-2">
      <Plus className="h-4 w-4" /> Add branch
      {isDemo && maxBranches ? (
        <span className="ml-1 text-xs opacity-80">(demo limit: {maxBranches})</span>
      ) : null}
    </Button>
  );
}