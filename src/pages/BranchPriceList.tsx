import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, History, Search, Check, X, Pencil, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { formatZonedYMD } from "@/lib/timezone";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { netFromListed, vatFromGross, netFromGross } from "@/lib/vatInclusive";

interface MenuItemLite {
  id: string;
  name: string;
  category: string;
  quarter_price: number;
  half_price: number;
  full_price: number;
}

interface PriceRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  menu_item_id: string;
  quarter_price: number | null;
  half_price: number | null;
  full_price: number | null;
  cost_override: number | null;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

interface PriceHistoryRow {
  id: string;
  action: "insert" | "update" | "delete";
  changed_by: string | null;
  effective_from: string | null;
  effective_to: string | null;
  before_data: any;
  after_data: any;
  note: string | null;
  created_at: string;
  actor_name?: string | null;
}

export default function BranchPriceList() {
  const { restaurant, hasRole } = useAuth();
  const { branches, activeBranchId, isAllBranches } = useBranch();
  const { format: fmt } = useCurrency();
  const qc = useQueryClient();
  const tz = (restaurant as any)?.timezone || "Asia/Riyadh";
  // Restaurant-local "today" — using UTC here made same-day prices look future-dated.
  const todayLocal = () => formatZonedYMD(new Date(), tz);

  const canEdit = hasRole("owner") || hasRole("manager");
  const branchOptions = branches.filter((b) => b.is_active);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    !isAllBranches && activeBranchId ? activeBranchId : branchOptions[0]?.id ?? ""
  );
  const [search, setSearch] = useState("");
  const { vatRate, vatPercent, pricesInclusive } = useBranchVatRate(selectedBranchId || null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState<MenuItemLite | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<MenuItemLite | null>(null);
  // Inline "Change price" editing (Quarter/Half) directly in the table row.
  const [inlineItemId, setInlineItemId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState({ quarter_price: "", half_price: "" });
  // Confirmation step shown before a save that closes or replaces an existing
  // price period, so the effect on history is explicit.
  const [confirmSave, setConfirmSave] = useState<
    | {
        kind: "editor" | "inline";
        item: MenuItemLite;
        title: string;
        lines: string[];
      }
    | null
  >(null);

  const [form, setForm] = useState({
    quarter_price: "",
    half_price: "",
    full_price: "",
    cost_override: "",
    effective_from: todayLocal(),
    effective_to: "",
    note: "",
  });

  const { data: items = [] } = useQuery({
    queryKey: ["price-editor-menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("menu_items")
        .select("id, name, category, quarter_price, half_price, full_price")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as MenuItemLite[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: activeRows = [] } = useQuery({
    queryKey: ["branch-price-active", selectedBranchId, todayLocal()],
    queryFn: async () => {
      if (!selectedBranchId) return [];
      const today = todayLocal();
      const { data, error } = await (db as any).rpc("get_branch_menu_prices", {
        _branch_id: selectedBranchId,
        _at: today,
      });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!selectedBranchId,
  });

  const activeByItem = useMemo(() => {
    const map = new Map<string, any>();
    (activeRows || []).forEach((r: any) => map.set(r.menu_item_id, r));
    return map;
  }, [activeRows]);

  const { data: historyRows = [] } = useQuery({
    queryKey: ["branch-price-history", selectedBranchId, historyItem?.id],
    queryFn: async () => {
      if (!selectedBranchId || !historyItem?.id) return [];
      const { data, error } = await db
        .from("menu_item_price_history" as any)
        .select("*")
        .eq("branch_id", selectedBranchId)
        .eq("menu_item_id", historyItem.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data as any[]) || [];
      const actorIds = Array.from(
        new Set(rows.map((r) => r.changed_by).filter(Boolean)),
      ) as string[];
      let nameMap: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: profs } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds);
        (profs || []).forEach((p: any) => {
          nameMap[p.id] = p.full_name || "";
        });
      }
      return rows.map((r) => ({
        ...r,
        actor_name: r.changed_by ? nameMap[r.changed_by] || "Unknown" : "System",
      })) as PriceHistoryRow[];
    },
    enabled: !!selectedBranchId && !!historyItem?.id && historyOpen,
  });

  // All existing price rows for the item currently being edited — used
  // by the client-side overlap check so users get feedback before the
  // server trigger rejects the save.
  const { data: editorExistingRows = [] } = useQuery({
    queryKey: ["branch-price-item-rows", selectedBranchId, editorItem?.id],
    queryFn: async () => {
      if (!selectedBranchId || !editorItem?.id) return [];
      const { data, error } = await db
        .from("menu_item_branch_prices" as any)
        .select("id, effective_from, effective_to")
        .eq("branch_id", selectedBranchId)
        .eq("menu_item_id", editorItem.id);
      if (error) return [];
      return (data as any[]) || [];
    },
    enabled: !!selectedBranchId && !!editorItem?.id && editorOpen,
  });

  // Shift a YYYY-MM-DD date string by N days (UTC-safe).
  const shiftDay = (ymd: string, days: number) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // A currently open row that starts BEFORE the new start date is closed
  // automatically by the save mutation, so it is not a real conflict.
  const autoClosedRow = useMemo(() => {
    if (!editorOpen || !form.effective_from) return null;
    return (
      (editorExistingRows as any[]).find(
        (r) => !r.effective_to && (r.effective_from as string) < form.effective_from,
      ) || null
    );
  }, [editorOpen, form.effective_from, editorExistingRows]);

  // An open row that starts on exactly the same day is replaced in place by
  // the save mutation (you cannot have two prices active the same day).
  const replacedRow = useMemo(() => {
    if (!editorOpen || !form.effective_from) return null;
    return (
      (editorExistingRows as any[]).find(
        (r) => !r.effective_to && (r.effective_from as string) === form.effective_from,
      ) || null
    );
  }, [editorOpen, form.effective_from, editorExistingRows]);

  const overlapInfo = useMemo(() => {
    if (!editorOpen || !form.effective_from) return null;
    const from = form.effective_from;
    const to = form.effective_to || "9999-12-31";
    if (form.effective_to && form.effective_to < form.effective_from) {
      return {
        message: "Effective end date must be on or after the start date.",
        conflict: null as any,
        fixes: [
          {
            label: `Clear the end date (leave the period open)`,
            apply: () => setForm((f: any) => ({ ...f, effective_to: "" })),
          },
          {
            label: `Set the end date to ${form.effective_from}`,
            apply: () => setForm((f: any) => ({ ...f, effective_to: form.effective_from })),
          },
        ],
      };
    }
    // Inclusive overlap ([from, to] intersects [rowFrom, rowTo]) to match the
    // database trigger, ignoring rows the save mutation resolves for us.
    const conflict = (editorExistingRows as any[]).find((r) => {
      if (autoClosedRow && r.id === autoClosedRow.id) return false;
      if (replacedRow && r.id === replacedRow.id) return false;
      const rf = r.effective_from as string;
      const rt = (r.effective_to as string) || "9999-12-31";
      return rf <= to && from <= rt;
    });
    if (!conflict) return null;
    const cFrom = conflict.effective_from as string;
    const cTo = (conflict.effective_to as string) || null;
    const fixes: { label: string; apply: () => void }[] = [];

    if (cTo) {
      const startAfter = shiftDay(cTo, 1);
      fixes.push({
        label: `Start this price on ${startAfter} (the day after the existing period ends)`,
        apply: () => setForm((f: any) => ({ ...f, effective_from: startAfter })),
      });
    }
    const endBefore = shiftDay(cFrom, -1);
    if (endBefore >= from) {
      fixes.push({
        label: `End this price on ${endBefore} (the day before the existing period starts)`,
        apply: () => setForm((f: any) => ({ ...f, effective_to: endBefore })),
      });
    }
    fixes.push({
      label: `Replace the existing period instead — start on ${cFrom}`,
      apply: () =>
        setForm((f: any) => ({
          ...f,
          effective_from: cFrom,
          effective_to: cTo ?? "",
        })),
    });

    return {
      message: `Overlaps existing period ${cFrom} → ${cTo ?? "open"}.`,
      conflict,
      fixes,
    };
  }, [editorOpen, form.effective_from, form.effective_to, editorExistingRows, autoClosedRow, replacedRow]);

  const overlapError = overlapInfo?.message ?? null;

  // Branch prices are VAT-INCLUSIVE: the entered value is the final payable
  // amount. It can never exceed the master (inclusive) menu price for that
  // tier, and the cost override can never exceed the net (ex-VAT) portion.
  const priceErrors = useMemo(() => {
    if (!editorOpen || !editorItem) return [] as string[];
    const errs: string[] = [];
    const tiers: Array<[string, string, number]> = [
      ["Quarter", form.quarter_price, Number(editorItem.quarter_price) || 0],
      ["Half", form.half_price, Number(editorItem.half_price) || 0],
      ["Full", form.full_price, Number(editorItem.full_price) || 0],
    ];
    let maxNet = 0;
    tiers.forEach(([label, raw, base]) => {
      if (raw === "" || raw == null) return;
      const v = Number(raw);
      if (!isFinite(v)) {
        errs.push(`${label}: enter a valid number.`);
        return;
      }
      if (v < 0) {
        errs.push(`${label}: price cannot be negative.`);
        return;
      }
      if (base > 0 && v > base) {
        errs.push(
          pricesInclusive
            ? `${label}: ${fmt(v)} exceeds the inclusive menu price ${fmt(base)} (net ${fmt(netFromGross(base, vatRate))} + VAT ${fmt(vatFromGross(base, vatRate))} at ${vatPercent}%). Prices already include VAT.`
            : `${label}: ${fmt(v)} exceeds the net menu price ${fmt(base)} (guest pays ${fmt(base * (1 + vatRate))} with ${vatPercent}% VAT added on top).`,
        );
        return;
      }
      maxNet = Math.max(maxNet, netFromListed(v, vatRate, pricesInclusive));
    });
    if (form.cost_override !== "") {
      const c = Number(form.cost_override);
      if (!isFinite(c) || c < 0) {
        errs.push("Cost override: enter a valid non-negative number.");
      } else if (maxNet > 0 && c > maxNet) {
        errs.push(
          `Cost override ${fmt(c)} exceeds the net (ex-VAT) selling price ${fmt(maxNet)} at ${vatPercent}% VAT.`,
        );
      }
    }
    return errs;
  }, [editorOpen, editorItem, form.quarter_price, form.half_price, form.full_price, form.cost_override, vatRate, vatPercent, pricesInclusive, fmt]);

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !selectedBranchId || !editorItem) throw new Error("Missing context");
      if (priceErrors.length > 0) throw new Error(priceErrors[0]);
      const payload = {
        restaurant_id: restaurant.id,
        branch_id: selectedBranchId,
        menu_item_id: editorItem.id,
        quarter_price: form.quarter_price ? Number(form.quarter_price) : null,
        half_price: form.half_price ? Number(form.half_price) : null,
        full_price: form.full_price ? Number(form.full_price) : null,
        cost_override: form.cost_override ? Number(form.cost_override) : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        note: form.note || null,
      };
      // Periods are date-INCLUSIVE in the DB, so an earlier open row must end
      // the day BEFORE the new period starts — otherwise they overlap.
      const prevDay = new Date(`${form.effective_from}T00:00:00Z`);
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      const closeOn = prevDay.toISOString().slice(0, 10);
      await db
        .from("menu_item_branch_prices" as any)
        .update({ effective_to: closeOn } as any)
        .eq("branch_id", selectedBranchId)
        .eq("menu_item_id", editorItem.id)
        .is("effective_to", null)
        .lt("effective_from", form.effective_from);

      if (replacedRow?.id) {
        // Same start date: update the existing open row in place.
        const { error } = await db
          .from("menu_item_branch_prices" as any)
          .update(payload as any)
          .eq("id", replacedRow.id);
        if (error) throw error;
        return;
      }
      const { error } = await db.from("menu_item_branch_prices" as any).insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-price-active", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-menu-prices", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-price-history", selectedBranchId] });
      setEditorOpen(false);
      toast.success("Price override saved");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save price"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await db.from("menu_item_branch_prices" as any).delete().eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-price-active", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-menu-prices", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-price-history", selectedBranchId] });
      toast.success("Price row removed");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to delete"),
  });

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s));
  }, [items, search]);

  // ---- Inline Quarter/Half price editing -------------------------------
  const startInline = (item: MenuItemLite) => {
    const existing = activeByItem.get(item.id);
    setInlineItemId(item.id);
    setInlineForm({
      quarter_price:
        existing?.quarter_price != null ? String(existing.quarter_price) : String(item.quarter_price ?? ""),
      half_price:
        existing?.half_price != null ? String(existing.half_price) : String(item.half_price ?? ""),
    });
  };
  const cancelInline = () => {
    setInlineItemId(null);
    setInlineForm({ quarter_price: "", half_price: "" });
  };

  const inlineMutation = useMutation({
    mutationFn: async (item: MenuItemLite) => {
      if (!restaurant?.id || !selectedBranchId) throw new Error("Missing context");
      const existing = activeByItem.get(item.id);
      const q = inlineForm.quarter_price === "" ? null : Number(inlineForm.quarter_price);
      const h = inlineForm.half_price === "" ? null : Number(inlineForm.half_price);
      const checks: Array<[string, number | null, number]> = [
        ["Quarter", q, Number(item.quarter_price) || 0],
        ["Half", h, Number(item.half_price) || 0],
      ];
      for (const [label, v, base] of checks) {
        if (v == null) continue;
        if (!isFinite(v) || v < 0) throw new Error(`${label}: enter a valid non-negative number.`);
        if (base > 0 && v > base) {
          throw new Error(`${label}: ${fmt(v)} exceeds the menu price ${fmt(base)}.`);
        }
      }

      const from = todayLocal();
      const payload = {
        restaurant_id: restaurant.id,
        branch_id: selectedBranchId,
        menu_item_id: item.id,
        quarter_price: q,
        half_price: h,
        full_price: existing?.full_price != null ? Number(existing.full_price) : null,
        cost_override: existing?.cost_override != null ? Number(existing.cost_override) : null,
        effective_from: from,
        effective_to: null,
        note: "Inline quick price change",
      };

      const { data: rows } = await db
        .from("menu_item_branch_prices" as any)
        .select("id, effective_from, effective_to")
        .eq("branch_id", selectedBranchId)
        .eq("menu_item_id", item.id);
      const sameDayOpen = ((rows as any[]) || []).find(
        (r) => !r.effective_to && r.effective_from === from,
      );

      // Periods are date-inclusive: close earlier open rows the day before.
      const prevDay = new Date(`${from}T00:00:00Z`);
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      await db
        .from("menu_item_branch_prices" as any)
        .update({ effective_to: prevDay.toISOString().slice(0, 10) } as any)
        .eq("branch_id", selectedBranchId)
        .eq("menu_item_id", item.id)
        .is("effective_to", null)
        .lt("effective_from", from);

      if (sameDayOpen?.id) {
        const { error } = await db
          .from("menu_item_branch_prices" as any)
          .update(payload as any)
          .eq("id", sameDayOpen.id);
        if (error) throw error;
        return;
      }
      const { error } = await db.from("menu_item_branch_prices" as any).insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-price-active", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-menu-prices", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-price-history", selectedBranchId] });
      qc.invalidateQueries({ queryKey: ["branch-price-item-rows", selectedBranchId] });
      cancelInline();
      toast.success("Price updated for this branch");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update price"),
  });

  const openEditor = (item: MenuItemLite) => {
    const existing = activeByItem.get(item.id);
    setEditorItem(item);
    setForm({
      quarter_price: existing?.quarter_price != null ? String(existing.quarter_price) : "",
      half_price: existing?.half_price != null ? String(existing.half_price) : "",
      full_price: existing?.full_price != null ? String(existing.full_price) : "",
      cost_override: existing?.cost_override != null ? String(existing.cost_override) : "",
      effective_from: todayLocal(),
      effective_to: "",
      note: "",
    });
    setEditorOpen(true);
  };

  const openHistory = (item: MenuItemLite) => {
    setHistoryItem(item);
    setHistoryOpen(true);
  };

  const prevDayOf = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  // Ask for confirmation only when the save mutates an existing period
  // (auto-close of the previous row, or in-place replace of a same-day row).
  const requestEditorSave = () => {
    if (!editorItem) return;
    const lines: string[] = [];
    if (replacedRow) {
      lines.push(
        `The open period starting ${replacedRow.effective_from} will be REPLACED in place with the new values (no duplicate row).`,
      );
    }
    if (autoClosedRow) {
      lines.push(
        `The open period starting ${autoClosedRow.effective_from} will be CLOSED on ${prevDayOf(form.effective_from)}.`,
      );
    }
    if (!lines.length) {
      upsertMutation.mutate();
      return;
    }
    lines.push(
      `New period: ${form.effective_from} → ${form.effective_to || "open"} · Quarter ${form.quarter_price || "—"} · Half ${form.half_price || "—"} · Full ${form.full_price || "—"}.`,
    );
    setConfirmSave({ kind: "editor", item: editorItem, title: "Confirm price period change", lines });
  };

  const requestInlineSave = (item: MenuItemLite) => {
    const existing = activeByItem.get(item.id);
    const from = todayLocal();
    const lines: string[] = [];
    if (existing && !existing.effective_to) {
      if (existing.effective_from === from) {
        lines.push(`Today's open period (${from}) will be REPLACED with the new Quarter/Half values.`);
      } else {
        lines.push(
          `The open period starting ${existing.effective_from} will be CLOSED on ${prevDayOf(from)} and a new period starts ${from}.`,
        );
      }
    }
    if (!lines.length) {
      inlineMutation.mutate(item);
      return;
    }
    lines.push(
      `New values: Quarter ${inlineForm.quarter_price || "—"} · Half ${inlineForm.half_price || "—"} (Full and cost override are kept).`,
    );
    setConfirmSave({ kind: "inline", item, title: `Confirm price change · ${item.name}`, lines });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="fade-slide-in">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Branch Price List</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage per-branch price and cost overrides with effective dates. Items without an override use the master menu price.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-end gap-4 pb-3">
          <div className="flex-1 space-y-1">
            <Label>Branch</Label>
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} {b.is_primary ? "· Primary" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label>Search</Label>
            <div className="relative max-w-sm">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item or category"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedBranchId ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Add a branch first to manage per-branch pricing.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Base Full</TableHead>
                    <TableHead className="text-right">Quarter</TableHead>
                    <TableHead className="text-right">Half</TableHead>
                    <TableHead className="text-right">Branch Full</TableHead>
                    <TableHead className="text-right">Branch Cost</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const row = activeByItem.get(item.id);
                    const overriding = !!row;
                    const isInline = inlineItemId === item.id;
                    const savingInline = isInline && inlineMutation.isPending;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {fmt(item.full_price || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isInline ? (
                            <Input
                              type="number"
                              step="0.01"
                              autoFocus
                              className="h-8 w-24 ml-auto text-right"
                              value={inlineForm.quarter_price}
                              onChange={(e) => setInlineForm((f) => ({ ...f, quarter_price: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") requestInlineSave(item);
                                if (e.key === "Escape") cancelInline();
                              }}
                            />
                          ) : overriding && row.quarter_price != null ? (
                            fmt(Number(row.quarter_price))
                          ) : (
                            <span className="text-muted-foreground">{fmt(item.quarter_price || 0)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isInline ? (
                            <Input
                              type="number"
                              step="0.01"
                              className="h-8 w-24 ml-auto text-right"
                              value={inlineForm.half_price}
                              onChange={(e) => setInlineForm((f) => ({ ...f, half_price: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") requestInlineSave(item);
                                if (e.key === "Escape") cancelInline();
                              }}
                            />
                          ) : overriding && row.half_price != null ? (
                            fmt(Number(row.half_price))
                          ) : (
                            <span className="text-muted-foreground">{fmt(item.half_price || 0)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {overriding && row.full_price != null ? fmt(Number(row.full_price)) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {overriding && row.cost_override != null ? fmt(Number(row.cost_override)) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {overriding ? (
                            <>
                              {format(new Date(row.effective_from), "MMM d, yyyy")}
                              {row.effective_to ? ` → ${format(new Date(row.effective_to), "MMM d, yyyy")}` : " → open"}
                            </>
                          ) : (
                            "Uses base price"
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {isInline ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => requestInlineSave(item)}
                                disabled={savingInline}
                              >
                                {savingInline ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelInline} disabled={savingInline}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openHistory(item)}>
                                <History className="h-4 w-4" />
                              </Button>
                              {canEdit && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Change Quarter/Half price inline"
                                    onClick={() => startInline(item)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => openEditor(item)}>
                                    {overriding ? "Update" : <><Plus className="h-4 w-4 mr-1" />Set</>}
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set branch price</DialogTitle>
            <DialogDescription>
              {editorItem?.name} · {branches.find((b) => b.id === selectedBranchId)?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Quarter</Label>
                <Input type="number" step="0.01" value={form.quarter_price}
                  onChange={(e) => setForm({ ...form, quarter_price: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Half</Label>
                <Input type="number" step="0.01" value={form.half_price}
                  onChange={(e) => setForm({ ...form, half_price: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Full</Label>
                <Input type="number" step="0.01" value={form.full_price}
                  onChange={(e) => setForm({ ...form, full_price: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cost override (optional)</Label>
              <Input type="number" step="0.01" value={form.cost_override}
                onChange={(e) => setForm({ ...form, cost_override: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Effective from</Label>
                <Input type="date" value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Effective to (optional)</Label>
                <Input type="date" value={form.effective_to}
                  onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave a tier empty to keep the base price for that tier. Setting a new row automatically closes the previous open period.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Prices are VAT-inclusive at {vatPercent}% — they cannot exceed the master menu price for the tier.
            </p>
            {priceErrors.map((err) => (
              <p key={err} className="text-[11px] text-destructive">{err}</p>
            ))}
            {overlapInfo && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1.5">
                <p className="text-[11px] text-destructive font-medium">{overlapInfo.message}</p>
                <p className="text-[11px] text-muted-foreground">Pick a fix:</p>
                <div className="flex flex-col items-start gap-1">
                  {overlapInfo.fixes.map((fix) => (
                    <button
                      key={fix.label}
                      type="button"
                      onClick={fix.apply}
                      className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80 text-left"
                    >
                      {fix.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!overlapError && autoClosedRow && (
              <p className="text-[11px] text-muted-foreground">
                The current open period ({autoClosedRow.effective_from} → open) will be closed on{" "}
                {form.effective_from} and this new price takes over from that date.
              </p>
            )}
            {!overlapError && replacedRow && (
              <p className="text-[11px] text-muted-foreground">
                A price period already starts on {form.effective_from} — it will be updated with these
                values instead of creating a duplicate row.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button
              onClick={() => requestEditorSave()}
              disabled={upsertMutation.isPending || !!overlapError || priceErrors.length > 0}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Price history</DialogTitle>
            <DialogDescription>{historyItem?.name}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Q</TableHead>
                  <TableHead className="text-right">H</TableHead>
                  <TableHead className="text-right">F</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyRows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground">No history</TableCell></TableRow>
                ) : (
                  historyRows.map((r) => {
                    const snap = (r.action === "delete" ? r.before_data : r.after_data) || {};
                    const num = (v: any) => (v != null ? fmt(Number(v)) : "—");
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(r.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-xs">{r.actor_name || "System"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={r.action === "delete" ? "destructive" : "secondary"}
                            className="text-[10px] capitalize"
                          >
                            {r.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {r.effective_from ? format(new Date(r.effective_from), "MMM d, yyyy") : "—"}
                          {" → "}
                          {r.effective_to ? format(new Date(r.effective_to), "MMM d, yyyy") : "open"}
                        </TableCell>
                        <TableCell className="text-right">{num(snap.quarter_price)}</TableCell>
                        <TableCell className="text-right">{num(snap.half_price)}</TableCell>
                        <TableCell className="text-right">{num(snap.full_price)}</TableCell>
                        <TableCell className="text-right">{num(snap.cost_override)}</TableCell>
                        <TableCell className="text-xs">{snap.note || r.note || "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation step for saves that close or replace an existing period */}
      <Dialog open={!!confirmSave} onOpenChange={(o) => { if (!o) setConfirmSave(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmSave?.title}</DialogTitle>
            <DialogDescription>
              Review what will change in this branch's price history before saving.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {confirmSave?.lines.map((l) => (
              <li key={l} className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSave(null)}>Cancel</Button>
            <Button
              disabled={upsertMutation.isPending || inlineMutation.isPending}
              onClick={() => {
                if (!confirmSave) return;
                if (confirmSave.kind === "editor") upsertMutation.mutate();
                else inlineMutation.mutate(confirmSave.item);
                setConfirmSave(null);
              }}
            >
              Confirm & save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}