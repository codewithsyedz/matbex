import { useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileCheck2, QrCode, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { parseZatcaQr } from "@/lib/zatcaQr";

const empty = { accountId: "", supplierName: "", vatNumber: "", invoiceNumber: "", invoiceDate: format(new Date(), "yyyy-MM-dd"), subtotal: "", vat: "", zatcaUuid: "", qr: "", notes: "" };

export default function ZatcaInvoices() {
  const { user, tenant } = useAuth();
  const tenantId = (tenant as { id?: string } | null)?.id ?? null;
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith("ar");
  const L = (en: string, a: string) => (ar ? a : en);
  const qc = useQueryClient();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? branches[0]?.id ?? "");
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const subtotal = Number(form.subtotal) || 0;
  const vat = Number(form.vat) || 0;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const branch = branches.find((b) => b.id === branchId);

  const applyQr = (raw: string) => {
    set("qr", raw);
    const parsed = parseZatcaQr(raw);
    if (!parsed) return;
    setForm((f) => ({
      ...f,
      qr: raw,
      supplierName: parsed.sellerName ?? f.supplierName,
      vatNumber: parsed.vatNumber ?? f.vatNumber,
      invoiceDate: parsed.timestamp ? parsed.timestamp.slice(0, 10) : f.invoiceDate,
      vat: parsed.vat !== undefined ? parsed.vat.toFixed(2) : f.vat,
      subtotal: parsed.total !== undefined ? (parsed.total - (parsed.vat ?? 0)).toFixed(2) : f.subtotal,
    }));
    toast.success(L("QR code read — check the details", "تمت قراءة رمز QR — راجع البيانات"));
  };

  const accounts = useQuery({
    queryKey: ["zatca-post-accounts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId!).in("account_type", ["expense", "cogs"]).eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidateBooks = () => {
    qc.invalidateQueries({ queryKey: ["zatca-purchase-invoices"] });
    qc.invalidateQueries({ queryKey: ["zatca-pl-reconciliation"] });
    qc.invalidateQueries({ queryKey: ["profit-loss-by-branch"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const postToBooks = async (invoiceId: string, accountId: string | null) => {
    const { data, error } = await supabase.rpc("post_zatca_purchase_invoice", { p_invoice_id: invoiceId, p_account_id: accountId ?? undefined });
    if (error) throw error;
    return (data as { status?: string } | null)?.status ?? "unknown";
  };
  const postMsg = (st: string) => st === "linked"
    ? L("Matched to an existing expense — its VAT is now split out", "تمت مطابقتها مع مصروف موجود وفصل الضريبة")
    : st === "posted" ? L("Posted to the books as a new expense with input VAT", "تم ترحيلها كمصروف جديد مع ضريبة المدخلات")
    : st === "needs_account" ? L("No matching expense — choose an expense account and post it", "لا يوجد مصروف مطابق — اختر حساب المصروف ثم رحّلها")
    : L("Saved", "تم الحفظ");

  const [rowAccount, setRowAccount] = useState<Record<string, string>>({});
  const post = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string | null }) => postToBooks(id, accountId),
    onSuccess: (st) => { toast.success(postMsg(st)); invalidateBooks(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useQuery({
    queryKey: ["zatca-purchase-invoices", fromDate, toDate, branchId],
    enabled: Boolean(fromDate && toDate),
    queryFn: async () => {
      let q = supabase.from("purchase_invoices")
        .select("id, invoice_number, invoice_date, supplier_name_text, supplier_vat_number, subtotal, tax_amount, total_amount, branch_id, image_url, zatca_uuid, posting_status, posting_note, linked_expense_id")
        .eq("source", "zatca_upload").gte("invoice_date", fromDate).lte("invoice_date", toDate)
        .order("invoice_date", { ascending: false });
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!user || !branch) throw new Error(L("Pick a branch", "اختر الفرع"));
      if (!form.invoiceNumber.trim()) throw new Error(L("Invoice number is required", "رقم الفاتورة مطلوب"));
      if (form.vatNumber && !/^3\d{13}3$/.test(form.vatNumber.trim())) throw new Error(L("Supplier VAT number must be 15 digits starting and ending with 3", "الرقم الضريبي للمورد 15 رقماً يبدأ وينتهي بـ 3"));
      if (subtotal <= 0) throw new Error(L("Amount before VAT must be above 0", "المبلغ قبل الضريبة يجب أن يكون أكبر من 0"));
      if (vat < 0) throw new Error(L("VAT can't be negative", "الضريبة لا يمكن أن تكون سالبة"));
      let imageUrl: string | null = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error(L("File must be under 5MB", "الملف يجب أن يكون أقل من 5MB"));
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const { data, error } = await supabase.storage.from("invoice-images").upload(`${branch.restaurant_id}/zatca-${Date.now()}.${ext}`, file, { upsert: false });
        if (error) throw error;
        imageUrl = `invoice-images/${data.path}`;
      }
      const { data: inserted, error } = await supabase.from("purchase_invoices").insert({
        restaurant_id: branch.restaurant_id,
        branch_id: branch.id,
        created_by: user.id,
        invoice_number: form.invoiceNumber.trim(),
        invoice_date: form.invoiceDate,
        subtotal, tax_amount: vat, total_amount: total,
        status: "pending",
        source: "zatca_upload",
        supplier_name_text: form.supplierName.trim() || null,
        supplier_vat_number: form.vatNumber.trim() || null,
        zatca_uuid: form.zatcaUuid.trim() || null,
        zatca_qr: form.qr.trim() || null,
        notes: form.notes.trim() || null,
        image_url: imageUrl,
      }).select("id").single();
      if (error) {
        if (error.code === "23505") throw new Error(L("This invoice was already entered", "هذه الفاتورة مُدخلة مسبقاً"));
        throw error;
      }
      // Post straight into the books: link to a matching expense, or post a new one.
      try {
        return await postToBooks(inserted.id, form.accountId || null);
      } catch (e) {
        toast.error(L("Invoice saved, but posting failed: ", "تم الحفظ لكن فشل الترحيل: ") + (e as Error).message);
        return "error";
      }
    },
    onSuccess: (st) => {
      if (st !== "error") toast.success(postMsg(st));
      setForm({ ...empty, invoiceDate: form.invoiceDate, accountId: form.accountId });
      setFile(null);
      invalidateBooks();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_invoices").delete().eq("id", id).eq("source", "zatca_upload").in("posting_status", ["not_posted", "needs_account"]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zatca-purchase-invoices"] });
      qc.invalidateQueries({ queryKey: ["zatca-pl-reconciliation"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = useMemo(() => (list.data ?? []).reduce((s, r) => ({ net: s.net + Number(r.subtotal), vat: s.vat + Number(r.tax_amount) }), { net: 0, vat: 0 }), [list.data]);
  const fmt = (n: number) => n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="container mx-auto max-w-6xl space-y-5 py-5 md:py-7">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold md:text-3xl"><FileCheck2 className="h-7 w-7 text-primary" />{L("ZATCA supplier invoices", "فواتير الموردين (ZATCA)")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{L("Enter the tax invoices you received from suppliers. Each one is matched to an existing expense (and its VAT split out) or posted as a new expense, so Profit & Loss and Financial Statements use the real figures.", "أدخل الفواتير الضريبية المستلمة من الموردين. تتم مطابقة كل فاتورة مع مصروف موجود وفصل ضريبتها أو ترحيلها كمصروف جديد، لتظهر الأرقام الحقيقية في القوائم المالية.")}</p>
      </header>

      <Card>
        <CardHeader className="border-b py-4"><CardTitle className="text-base">{L("New invoice", "فاتورة جديدة")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label className="flex items-center gap-1.5"><QrCode className="h-3.5 w-3.5" />{L("ZATCA QR code text (optional — fills the form)", "نص رمز QR (اختياري — يملأ النموذج)")}</Label>
            <Textarea rows={2} value={form.qr} onChange={(e) => applyQr(e.target.value)} placeholder="AQ..." className="font-mono text-xs" />
          </div>
          <div><Label>{L("Branch", "الفرع")}</Label><Select value={branchId} onValueChange={setBranchId}><SelectTrigger><SelectValue placeholder={L("Pick a branch", "اختر الفرع")} /></SelectTrigger><SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>{L("Supplier name", "اسم المورد")}</Label><Input value={form.supplierName} onChange={(e) => set("supplierName", e.target.value)} /></div>
          <div><Label>{L("Supplier VAT number", "الرقم الضريبي للمورد")}</Label><Input inputMode="numeric" maxLength={15} value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value.replace(/\D/g, ""))} placeholder="3xxxxxxxxxxxxx3" /></div>
          <div><Label>{L("Invoice number", "رقم الفاتورة")}</Label><Input value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} /></div>
          <div><Label>{L("Invoice date", "تاريخ الفاتورة")}</Label><Input type="date" value={form.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} /></div>
          <div><Label>{L("ZATCA invoice UUID (optional)", "المعرّف الفريد UUID (اختياري)")}</Label><Input value={form.zatcaUuid} onChange={(e) => set("zatcaUuid", e.target.value)} /></div>
          <div><Label>{L("Amount before VAT", "المبلغ قبل الضريبة")}</Label><Input type="number" min="0" step="0.01" value={form.subtotal} onChange={(e) => set("subtotal", e.target.value)} /></div>
          <div><Label>{L("VAT", "الضريبة")}</Label><Input type="number" min="0" step="0.01" value={form.vat} onChange={(e) => set("vat", e.target.value)} />
            {subtotal > 0 && <button type="button" className="mt-1 text-xs text-primary underline-offset-2 hover:underline" onClick={() => set("vat", (subtotal * 0.15).toFixed(2))}>{L("Use 15%", "استخدم 15%")}</button>}</div>
          <div><Label>{L("Total incl. VAT", "الإجمالي شامل الضريبة")}</Label><Input readOnly value={fmt(total)} className="bg-muted/40 tabular-nums" /></div>
          <div><Label>{L("Expense account (used if no matching expense)", "حساب المصروف (عند عدم وجود مصروف مطابق)")}</Label><Select value={form.accountId} onValueChange={(v) => set("accountId", v)}><SelectTrigger><SelectValue placeholder={L("Choose account", "اختر الحساب")} /></SelectTrigger><SelectContent>{(accounts.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.account_code} · {a.account_name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>{L("Notes", "ملاحظات")}</Label><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          <div><Label>{L("Invoice photo or PDF", "صورة أو PDF للفاتورة")}</Label><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <div className="md:col-span-3 flex justify-end"><Button onClick={() => save.mutate()} disabled={save.isPending}><Upload className="me-1.5 h-4 w-4" />{save.isPending ? L("Saving…", "جارٍ الحفظ…") : L("Save invoice", "حفظ الفاتورة")}</Button></div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-4">
          <CardTitle className="text-base">{L("Entered invoices", "الفواتير المُدخلة")} <Badge variant="outline" className="ms-1">{list.data?.length ?? 0}</Badge></CardTitle>
          <div className="flex gap-2"><Input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-[150px]" /><Input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-[150px]" /></div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader><TableRow>
                <TableHead>{L("Date", "التاريخ")}</TableHead><TableHead>{L("Invoice", "الفاتورة")}</TableHead><TableHead>{L("Supplier", "المورد")}</TableHead><TableHead>{L("Branch", "الفرع")}</TableHead>
                <TableHead className="text-end">{L("Before VAT", "قبل الضريبة")}</TableHead><TableHead className="text-end">{L("VAT", "الضريبة")}</TableHead><TableHead className="text-end">{L("Total", "الإجمالي")}</TableHead><TableHead>{L("In the books", "في الدفاتر")}</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {(list.data ?? []).length === 0 ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">{list.isLoading ? L("Loading…", "جارٍ التحميل…") : L("No ZATCA invoices in this period yet.", "لا توجد فواتير في هذه الفترة.")}</TableCell></TableRow>
                  : (list.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.invoice_date}</TableCell>
                      <TableCell className="text-sm">{r.invoice_number}</TableCell>
                      <TableCell className="text-sm">{r.supplier_name_text ?? "—"}<span className="block font-mono text-[11px] text-muted-foreground">{r.supplier_vat_number}</span></TableCell>
                      <TableCell className="text-xs">{branches.find((b) => b.id === r.branch_id)?.name ?? "—"}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(Number(r.subtotal))}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(Number(r.tax_amount))}</TableCell>
                      <TableCell className="text-end font-medium tabular-nums">{fmt(Number(r.total_amount))}</TableCell>
                      <TableCell className="min-w-[220px] text-xs">
                        {r.posting_status === "linked" ? <Badge variant="secondary">{L("Matched to expense", "مطابقة مع مصروف")}</Badge>
                          : r.posting_status === "posted" ? <Badge>{L("Posted", "مُرحّلة")}</Badge>
                          : (
                            <div className="flex items-center gap-1.5">
                              <Select value={rowAccount[r.id] ?? ""} onValueChange={(v) => setRowAccount((m) => ({ ...m, [r.id]: v }))}>
                                <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder={L("Account", "الحساب")} /></SelectTrigger>
                                <SelectContent>{(accounts.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.account_code} · {a.account_name}</SelectItem>)}</SelectContent>
                              </Select>
                              <Button size="sm" variant="outline" className="h-8" disabled={post.isPending} onClick={() => post.mutate({ id: r.id, accountId: rowAccount[r.id] || null })}>{L("Post", "ترحيل")}</Button>
                            </div>
                          )}
                        {r.posting_note && <span className="mt-1 block text-[11px] text-muted-foreground">{r.posting_note}</span>}
                      </TableCell>
                      <TableCell className="text-end">{(r.posting_status === "not_posted" || r.posting_status === "needs_account") && <Button variant="ghost" size="icon" aria-label={L("Delete", "حذف")} onClick={() => { if (confirm(L("Delete this invoice?", "حذف هذه الفاتورة؟"))) remove.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                    </TableRow>
                  ))}
                {(list.data ?? []).length > 0 && <TableRow className="bg-muted/30 font-semibold"><TableCell colSpan={4}>{L("Total", "الإجمالي")}</TableCell><TableCell className="text-end tabular-nums">{fmt(totals.net)}</TableCell><TableCell className="text-end tabular-nums">{fmt(totals.vat)}</TableCell><TableCell className="text-end tabular-nums">{fmt(totals.net + totals.vat)}</TableCell><TableCell /><TableCell /></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
