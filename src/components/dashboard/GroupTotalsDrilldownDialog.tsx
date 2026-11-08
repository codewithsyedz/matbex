import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format as formatDate } from "date-fns";

export interface DrilldownTarget {
  /** Bucket key: yyyy-MM (month) or yyyy-MM-dd (week start / day) */
  key: string;
  label: string;
  granularity: "month" | "week" | "day";
  startDate: string; // yyyy-MM-dd inclusive
  endDate: string; // yyyy-MM-dd inclusive
  /** Empty/undefined = all branches. */
  branchIds?: string[];
  /** Human label for the branch scope, e.g. "all branches". */
  branchLabel?: string;
  /** When true the dialog opens on the per-branch comparison tab. */
  compare?: boolean;
}

interface Props {
  target: DrilldownTarget | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Drilldown for a selected month/week/day of the group totals chart: shows the
 * underlying day-close sales rows and expense rows (all branches) plus totals.
 */
export function GroupTotalsDrilldownDialog({ target, onOpenChange }: Props) {
  const { restaurant } = useAuth();
  const { format: money } = useCurrency();
  const restaurantId = restaurant?.id;

  const branchIds = target?.branchIds ?? [];
  const branchKey = [...branchIds].sort().join(",");

  const { data, isLoading } = useQuery({
    queryKey: [
      "group-totals-drilldown",
      restaurantId,
      target?.startDate,
      target?.endDate,
      branchKey,
    ],
    enabled: !!restaurantId && !!target,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let salesQuery = supabase
        .from("daily_sales_summary")
        .select(
          "id, sales_date, branch_id, cash_sales, card_sales, delivery_sales, other_sales, total_sales, status",
        )
        .eq("restaurant_id", restaurantId!)
        .gte("sales_date", target!.startDate)
        .lte("sales_date", target!.endDate)
        .order("sales_date", { ascending: true });
      if (branchIds.length) salesQuery = salesQuery.in("branch_id", branchIds);
      const buildExpenses = () => {
        let q = supabase
          .from("expenses")
          .select(
            "id, expense_date, branch_id, amount, description, payment_method, status, category_id, vat_amount, supplier_id",
          )
          .eq("restaurant_id", restaurantId!)
          .is("deleted_at", null)
          .gte("expense_date", target!.startDate)
          .lte("expense_date", target!.endDate);
        if (branchIds.length) q = q.in("branch_id", branchIds);
        return q.order("expense_date", { ascending: true }).order("id", { ascending: true });
      };
      // Page past the 1,000-row request cap so totals are never truncated.
      const fetchAllExpenses = async () => {
        const all: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await buildExpenses().range(from, from + 999);
          if (error) return { data: null, error };
          all.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        return { data: all, error: null };
      };
      const [salesRes, expenseRes, branchRes] = await Promise.all([
        salesQuery,
        fetchAllExpenses(),
        supabase.from("branches").select("id, name").eq("restaurant_id", restaurantId!),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (expenseRes.error) throw expenseRes.error;

      const categoryIds = [
        ...new Set((expenseRes.data ?? []).map((e: any) => e.category_id).filter(Boolean)),
      ];
      let categories: Record<string, string> = {};
      if (categoryIds.length) {
        const catRes = await supabase
          .from("expense_categories")
          .select("id, name")
          .in("id", categoryIds as string[]);
        categories = Object.fromEntries(
          (catRes.data ?? []).map((c: any) => [c.id, c.name as string]),
        );
      }

      const supplierIds = [
        ...new Set((expenseRes.data ?? []).map((e: any) => e.supplier_id).filter(Boolean)),
      ];
      let suppliers: Record<string, string> = {};
      if (supplierIds.length) {
        const supRes = await supabase
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds as string[]);
        suppliers = Object.fromEntries(
          (supRes.data ?? []).map((s: any) => [s.id, s.name as string]),
        );
      }

      const branchNames: Record<string, string> = Object.fromEntries(
        (branchRes.data ?? []).map((b: any) => [b.id, b.name as string]),
      );

      const sales = (salesRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        date: String(r.sales_date),
        branch: r.branch_id ? branchNames[r.branch_id] ?? "—" : "Unassigned",
        cash: Number(r.cash_sales || 0),
        card: Number(r.card_sales || 0),
        delivery: Number(r.delivery_sales || 0),
        other: Number(r.other_sales || 0),
        total: Number(r.total_sales || 0),
        status: (r.status as string) ?? "",
      }));

      const expenses = (expenseRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        date: String(r.expense_date),
        branch: r.branch_id ? branchNames[r.branch_id] ?? "—" : "Unassigned",
        category: r.category_id ? categories[r.category_id] ?? "—" : "—",
        description: (r.description as string) ?? "",
        method: (r.payment_method as string) ?? "",
        status: (r.status as string) ?? "",
        supplier: r.supplier_id ? suppliers[r.supplier_id] ?? "—" : "—",
        vat: Number(r.vat_amount || 0),
        amount: Number(r.amount || 0),
      }));

      return {
        sales,
        expenses,
        totalSales: sales.reduce((s, r) => s + r.total, 0),
        totalExpenses: expenses.reduce((s, r) => s + r.amount, 0),
      };
    },
  });

  /** Per-branch totals for the side-by-side comparison tab. */
  const branchComparison = useMemo(() => {
    const map = new Map<
      string,
      { branch: string; sales: number; expenses: number }
    >();
    (data?.sales ?? []).forEach((r) => {
      const cur = map.get(r.branch) ?? { branch: r.branch, sales: 0, expenses: 0 };
      cur.sales += r.total;
      map.set(r.branch, cur);
    });
    (data?.expenses ?? []).forEach((r) => {
      const cur = map.get(r.branch) ?? { branch: r.branch, sales: 0, expenses: 0 };
      cur.expenses += r.amount;
      map.set(r.branch, cur);
    });
    return [...map.values()]
      .map((r) => ({ ...r, net: r.sales - r.expenses }))
      .sort((a, b) => b.sales - a.sales);
  }, [data]);

  const net = (data?.totalSales ?? 0) - (data?.totalExpenses ?? 0);

  const num = (n: number) => Number(n.toFixed(2));

  const exportBase = `group-totals-${target?.key ?? "export"}`;

  const exportCSV = () => {
    if (!data) return;
    const lines: string[] = [];
    const esc = (v: string | number) => {
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const sum = (rows: { total: number }[]) => num(rows.reduce((s, r) => s + r.total, 0));
    lines.push(`${restaurant?.name ?? "Group totals"} — ${target?.label ?? ""}`);
    lines.push(`Period,${rangeLabel}`);
    lines.push(`Branches,${target?.branchLabel ?? "all branches"}`);
    lines.push(`Generated,${formatDate(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push(`Sales,${num(data.totalSales)},Expenses,${num(data.totalExpenses)},Net,${num(net)}`);
    lines.push("");
    lines.push("By branch");
    lines.push("Branch,Sales,Expenses,Net");
    branchComparison.forEach((r) =>
      lines.push([r.branch, num(r.sales), num(r.expenses), num(r.net)].map(esc).join(",")),
    );
    lines.push(
      ["Total", num(data.totalSales), num(data.totalExpenses), num(net)].map(esc).join(","),
    );
    lines.push("");
    lines.push("Sales");
    lines.push("Date,Branch,Status,Cash,Card,Delivery,Other,Total");
    data.sales.forEach((r) =>
      lines.push(
        [r.date, r.branch, r.status, num(r.cash), num(r.card), num(r.delivery), num(r.other), num(r.total)]
          .map(esc)
          .join(","),
      ),
    );
    lines.push(
      [
        "Total",
        "",
        "",
        num(data.sales.reduce((s, r) => s + r.cash, 0)),
        num(data.sales.reduce((s, r) => s + r.card, 0)),
        num(data.sales.reduce((s, r) => s + r.delivery, 0)),
        num(data.sales.reduce((s, r) => s + r.other, 0)),
        sum(data.sales),
      ].map(esc).join(","),
    );
    lines.push("");
    lines.push("Expenses");
    lines.push("Date,Branch,Category,Supplier,Description,Method,Status,VAT,Amount");
    data.expenses.forEach((r) =>
      lines.push(
        [r.date, r.branch, r.category, r.supplier, r.description, r.method, r.status, num(r.vat), num(r.amount)]
          .map(esc)
          .join(","),
      ),
    );
    lines.push(
      [
        "Total",
        "",
        "",
        "",
        "",
        "",
        "",
        num(data.expenses.reduce((s, r) => s + r.vat, 0)),
        num(data.totalExpenses),
      ].map(esc).join(","),
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${exportBase}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportExcel = async () => {
    if (!data) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const summary = XLSX.utils.aoa_to_sheet([
      [`${restaurant?.name ?? "Group totals"} — ${target?.label ?? ""}`],
      ["Period", rangeLabel],
      ["Branches", target?.branchLabel ?? "all branches"],
      ["Generated", formatDate(new Date(), "yyyy-MM-dd HH:mm")],
      [],
      ["Sales", num(data.totalSales)],
      ["Expenses", num(data.totalExpenses)],
      ["Net", num(net)],
      [],
      ["Branch", "Sales", "Expenses", "Net"],
      ...branchComparison.map((r) => [r.branch, num(r.sales), num(r.expenses), num(r.net)]),
      ["Total", num(data.totalSales), num(data.totalExpenses), num(net)],
    ]);
    XLSX.utils.book_append_sheet(wb, summary, "Summary");
    const salesSheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Branch", "Status", "Cash", "Card", "Delivery", "Other", "Total"],
      ...data.sales.map((r) => [
        r.date, r.branch, r.status, num(r.cash), num(r.card), num(r.delivery), num(r.other), num(r.total),
      ]),
      [
        "Total", "", "",
        num(data.sales.reduce((s, r) => s + r.cash, 0)),
        num(data.sales.reduce((s, r) => s + r.card, 0)),
        num(data.sales.reduce((s, r) => s + r.delivery, 0)),
        num(data.sales.reduce((s, r) => s + r.other, 0)),
        num(data.totalSales),
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, salesSheet, "Sales");
    const expSheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Branch", "Category", "Supplier", "Description", "Method", "Status", "VAT", "Amount"],
      ...data.expenses.map((r) => [
        r.date, r.branch, r.category, r.supplier, r.description, r.method, r.status, num(r.vat), num(r.amount),
      ]),
      [
        "Total", "", "", "", "", "", "",
        num(data.expenses.reduce((s, r) => s + r.vat, 0)),
        num(data.totalExpenses),
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, expSheet, "Expenses");
    XLSX.writeFile(wb, `${exportBase}.xlsx`);
  };

  const exportPDF = async () => {
    if (!data) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`${restaurant?.name ?? "Group totals"} — ${target?.label ?? ""}`, 14, 14);
    doc.setFontSize(9);
    doc.text(
      `${rangeLabel} · ${target?.branchLabel ?? "all branches"} · Generated ${formatDate(new Date(), "yyyy-MM-dd HH:mm")}`,
      14,
      20,
    );
    doc.text(
      `Sales: ${num(data.totalSales)}   Expenses: ${num(data.totalExpenses)}   Net: ${num(net)}`,
      14,
      26,
    );
    autoTable(doc, {
      startY: 30,
      head: [["Branch", "Sales", "Expenses", "Net"]],
      body: branchComparison.map((r) => [r.branch, num(r.sales), num(r.expenses), num(r.net)]),
      foot: [["Total", num(data.totalSales), num(data.totalExpenses), num(net)]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [0, 168, 89] },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [["Date", "Branch", "Status", "Cash", "Card", "Delivery", "Other", "Total"]],
      body: data.sales.map((r) => [
        r.date, r.branch, r.status, num(r.cash), num(r.card), num(r.delivery), num(r.other), num(r.total),
      ]),
      foot: [[
        "Total", "", "",
        num(data.sales.reduce((s, r) => s + r.cash, 0)),
        num(data.sales.reduce((s, r) => s + r.card, 0)),
        num(data.sales.reduce((s, r) => s + r.delivery, 0)),
        num(data.sales.reduce((s, r) => s + r.other, 0)),
        num(data.totalSales),
      ]],
      styles: { fontSize: 7 },
      headStyles: { fillColor: [0, 168, 89] },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [["Date", "Branch", "Category", "Supplier", "Description", "Method", "Status", "VAT", "Amount"]],
      body: data.expenses.map((r) => [
        r.date, r.branch, r.category, r.supplier, r.description, r.method, r.status, num(r.vat), num(r.amount),
      ]),
      foot: [[
        "Total", "", "", "", "", "", "",
        num(data.expenses.reduce((s, r) => s + r.vat, 0)),
        num(data.totalExpenses),
      ]],
      styles: { fontSize: 7 },
      headStyles: { fillColor: [0, 168, 89] },
    });
    doc.save(`${exportBase}.pdf`);
  };

  const rangeLabel = useMemo(() => {
    if (!target) return "";
    if (target.granularity === "day") {
      return formatDate(new Date(`${target.startDate}T00:00:00`), "EEEE, d MMM yyyy");
    }
    return `${formatDate(new Date(`${target.startDate}T00:00:00`), "d MMM yyyy")} – ${formatDate(
      new Date(`${target.endDate}T00:00:00`),
      "d MMM yyyy",
    )}`;
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pe-6">
            <div>
              <DialogTitle className="text-base">
                {target?.label} · underlying transactions
              </DialogTitle>
              <DialogDescription>
                {rangeLabel} · {target?.branchLabel ?? "all branches"}
              </DialogDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={isLoading || !data}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportExcel} className="gap-2 text-xs">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV} className="gap-2 text-xs">
                  <FileText className="h-3.5 w-3.5" />
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPDF} className="gap-2 text-xs">
                  <FileDown className="h-3.5 w-3.5" />
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/40 p-3">
            <p className="text-xs text-muted-foreground">Sales</p>
            <p className="text-sm font-semibold mt-1 tabular-nums">
              {money(data?.totalSales ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-border/40 p-3">
            <p className="text-xs text-muted-foreground">Expenses</p>
            <p className="text-sm font-semibold mt-1 tabular-nums text-destructive">
              {money(data?.totalExpenses ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-border/40 p-3">
            <p className="text-xs text-muted-foreground">Net</p>
            <p
              className={cn(
                "text-sm font-semibold mt-1 tabular-nums",
                net < 0 ? "text-destructive" : "text-primary",
              )}
            >
              {money(net)}
            </p>
          </div>
        </div>

        <Tabs
          defaultValue={target?.compare ? "branches" : "sales"}
          key={target?.key ?? "none"}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="w-full">
            <TabsTrigger value="branches" className="flex-1">
              By branch ({branchComparison.length})
            </TabsTrigger>
            <TabsTrigger value="sales" className="flex-1">
              Sales ({data?.sales.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="expenses" className="flex-1">
              Expenses ({data?.expenses.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branches" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[45vh] rounded-lg border border-border/40">
              {isLoading ? (
                <div className="p-3 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : !branchComparison.length ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  No branch activity in this period.
                </p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5">Branch</th>
                      <th className="text-right font-medium px-2 py-1.5">Sales</th>
                      <th className="text-right font-medium px-2 py-1.5">Expenses</th>
                      <th className="text-right font-medium px-2 py-1.5">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchComparison.map((r) => (
                      <tr key={r.branch} className="border-t border-border/40">
                        <td className="px-2 py-1.5 truncate max-w-[180px]">{r.branch}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.sales)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-destructive/80">
                          {money(r.expenses)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-medium",
                            r.net < 0 && "text-destructive",
                          )}
                        >
                          {money(r.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="sales" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[45vh] rounded-lg border border-border/40">
              {isLoading ? (
                <div className="p-3 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : !data?.sales.length ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  No day-close sales recorded in this period.
                </p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5">Date</th>
                      <th className="text-left font-medium px-2 py-1.5">Branch</th>
                      <th className="text-right font-medium px-2 py-1.5">Cash</th>
                      <th className="text-right font-medium px-2 py-1.5">Card</th>
                      <th className="text-right font-medium px-2 py-1.5">Delivery</th>
                      <th className="text-right font-medium px-2 py-1.5">Other</th>
                      <th className="text-right font-medium px-2 py-1.5">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map((r) => (
                      <tr key={r.id} className="border-t border-border/40">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {formatDate(new Date(`${r.date}T00:00:00`), "d MMM")}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate max-w-[140px]">{r.branch}</span>
                            {r.status && r.status !== "approved" && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                                {r.status}
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.cash)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.card)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.delivery)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.other)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {money(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="expenses" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[45vh] rounded-lg border border-border/40">
              {isLoading ? (
                <div className="p-3 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : !data?.expenses.length ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  No expenses recorded in this period.
                </p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5">Date</th>
                      <th className="text-left font-medium px-2 py-1.5">Branch</th>
                      <th className="text-left font-medium px-2 py-1.5">Category</th>
                      <th className="text-left font-medium px-2 py-1.5">Description</th>
                      <th className="text-right font-medium px-2 py-1.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expenses.map((r) => (
                      <tr key={r.id} className="border-t border-border/40">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {formatDate(new Date(`${r.date}T00:00:00`), "d MMM")}
                        </td>
                        <td className="px-2 py-1.5 truncate max-w-[120px]">{r.branch}</td>
                        <td className="px-2 py-1.5 truncate max-w-[120px]">{r.category}</td>
                        <td className="px-2 py-1.5 truncate max-w-[200px]">{r.description}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-destructive/90">
                          {money(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}