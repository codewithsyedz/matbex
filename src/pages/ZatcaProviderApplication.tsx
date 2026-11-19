import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileCheck2, FileText, Loader2, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { ZatcaStatusTracker } from "@/components/zatca/ZatcaStatusTracker";
import { zatcaReminderDue } from "@/lib/zatcaApplicationReminder";

type Doc = { id: string; en: string; ar: string; noteEn: string; noteAr: string };
type Group = { en: string; ar: string; docs: Doc[] };

const GROUPS: Group[] = [
  { en: "Company documents", ar: "مستندات المنشأة", docs: [
    { id: "cr", en: "Commercial Registration (CR)", ar: "السجل التجاري", noteEn: "Valid and active, covering software/IT activity.", noteAr: "ساري ويشمل نشاط البرمجيات أو تقنية المعلومات." },
    { id: "vat", en: "VAT registration certificate", ar: "شهادة التسجيل في ضريبة القيمة المضافة", noteEn: "15-digit VAT number.", noteAr: "رقم ضريبي من 15 خانة." },
    { id: "auth", en: "Authorization letter for the applicant", ar: "خطاب تفويض لمقدم الطلب", noteEn: "Signed by an authorized signatory, on company letterhead.", noteAr: "موقّع من المفوض بالتوقيع على ورق المنشأة." },
    { id: "contact", en: "Official contact details", ar: "بيانات التواصل الرسمية", noteEn: "Company email, phone, national address.", noteAr: "البريد والهاتف والعنوان الوطني." },
  ]},
  { en: "Solution & compliance", ar: "الحل والامتثال", docs: [
    { id: "desc", en: "Solution description", ar: "وصف الحل", noteEn: "What the product does, deployment model (cloud), supported invoice types.", noteAr: "وظائف المنتج ونموذج التشغيل وأنواع الفواتير المدعومة." },
    { id: "csid", en: "Compliance CSID onboarding passed", ar: "اجتياز الربط والحصول على شهادة الامتثال (CSID)", noteEn: "Through the Fatoora developer/simulation portal.", noteAr: "عبر بوابة فاتورة للمطورين/المحاكاة." },
    { id: "samples", en: "Sample invoices (UBL 2.1 XML)", ar: "نماذج فواتير بصيغة XML (UBL 2.1)", noteEn: "Standard + simplified invoices, credit and debit notes, passing compliance checks.", noteAr: "فواتير ضريبية ومبسطة وإشعارات دائن ومدين تجتاز فحص الامتثال." },
    { id: "qr", en: "QR code and cryptographic stamp evidence", ar: "إثبات رمز QR والختم التشفيري", noteEn: "Screenshots of printed/simplified invoices with QR.", noteAr: "لقطات لفواتير مطبوعة تحتوي رمز QR." },
    { id: "security", en: "Security & data-retention statement", ar: "بيان الأمان وحفظ البيانات", noteEn: "Tamper protection, invoice counter, hash chaining, storage location.", noteAr: "منع التلاعب وعداد الفواتير وسلسلة التجزئة وموقع التخزين." },
  ]},
  { en: "Submission", ar: "التقديم", docs: [
    { id: "form", en: "Application form completed on ZATCA's site", ar: "تعبئة نموذج الطلب في موقع الهيئة", noteEn: "Use the official link below.", noteAr: "استخدم الرابط الرسمي أدناه." },
    { id: "ref", en: "Submission reference number saved", ar: "حفظ رقم الطلب", noteEn: "Record it in the notes below.", noteAr: "سجّله في الملاحظات أدناه." },
  ]},
];

// The last group describes the submission itself, not files to upload.
const FILE_GROUPS = GROUPS.filter((g) => !g.docs.some((d) => d.id === "form"));
const ZATCA_PORTAL = "https://zatca.gov.sa/en/E-Invoicing/SolutionProviders/Pages/default.aspx";

const FIELDS = [
  ["company_name", "Company legal name", "الاسم النظامي للمنشأة"],
  ["cr_number", "Commercial registration number", "رقم السجل التجاري"],
  ["vat_number", "VAT number (15 digits)", "الرقم الضريبي (15 رقماً)"],
  ["national_address", "National address", "العنوان الوطني"],
  ["contact_name", "Contact person", "الشخص المسؤول"],
  ["contact_email", "Contact email", "البريد الإلكتروني"],
  ["contact_phone", "Contact phone", "رقم الجوال"],
  ["solution_name", "Solution name", "اسم الحل"],
] as const;
type FieldKey = (typeof FIELDS)[number][0] | "solution_description" | "notes";
type App = Record<FieldKey, string | null> & { id: string; status: string; zatca_reference: string | null; submitted_at: string | null; created_at: string;
  decision_at: string | null; zatca_reply: string | null; reminder_days: number | null; status_changed_at: string | null };
type DocRow = { id: string; doc_key: string; file_name: string; file_path: string; created_at: string };

export default function ZatcaProviderApplication() {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith("ar");
  const L = (en: string, a: string) => (ar ? a : en);
  const { user, tenant } = useAuth();
  const tenantId = (tenant as { id?: string } | null)?.id ?? null;
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Record<FieldKey, string>>>({});
  const [reference, setReference] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const applications = useQuery({
    queryKey: ["zatca-provider-app", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await db.from("zatca_provider_applications").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as App[];
    },
  });
  const app = { data: selectedId ? applications.data?.find((a) => a.id === selectedId) ?? null : applications.data?.[0] ?? null };
  const docs = useQuery({
    queryKey: ["zatca-provider-docs", app.data?.id],
    enabled: !!app.data?.id,
    queryFn: async () => {
      const applicationId = app.data?.id;
      if (!applicationId) return [];
      const { data, error } = await db.from("zatca_provider_application_documents")
        .select("id, doc_key, file_name, file_path, created_at").eq("application_id", applicationId).is("deleted_at", null).order("created_at");
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
  });

  useEffect(() => {
    if (!app.data) return;
    const f: Partial<Record<FieldKey, string>> = {};
    for (const [k] of FIELDS) f[k] = app.data[k] ?? "";
    f.solution_description = app.data.solution_description ?? "";
    f.notes = app.data.notes ?? "";
    setForm(f);
    setReference(app.data.zatca_reference ?? "");
  }, [app.data]);

  const ensureApp = async (): Promise<string> => {
    if (app.data?.id) return app.data.id;
    if (!tenantId) throw new Error(L("No company selected", "لم يتم تحديد المنشأة"));
    const { data, error } = await db.from("zatca_provider_applications")
      .insert({ tenant_id: tenantId, created_by: user?.id ?? null }).select("id").single();
    if (error) throw error;
    setSelectedId(data.id);
    await qc.invalidateQueries({ queryKey: ["zatca-provider-app"] });
    return data.id;
  };

  const newApplication = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error(L("No company selected", "لم يتم تحديد المنشأة"));
      const { data, error } = await db.from("zatca_provider_applications")
        .insert({ tenant_id: tenantId, created_by: user?.id ?? null }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["zatca-provider-app"] });
      setSelectedId(id); setForm({}); setReference("");
      toast.success(L("New application created", "تم إنشاء طلب جديد"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async (extra: Record<string, unknown> = {}) => {
      if (!tenantId) throw new Error(L("No company selected", "لم يتم تحديد المنشأة"));
      const vat = (form.vat_number ?? "").trim();
      if (vat && !/^3\d{13}3$/.test(vat)) throw new Error(L("VAT number must be 15 digits starting and ending with 3", "الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3"));
      const email = (form.contact_email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(L("Enter a valid email", "أدخل بريداً صحيحاً"));
      const id = await ensureApp();
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString(), ...extra };
      for (const [k, v] of Object.entries(form)) payload[k] = (v ?? "").trim().slice(0, k === "solution_description" || k === "notes" ? 4000 : 300) || null;
      const { error } = await db.from("zatca_provider_applications").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L("Application saved", "تم حفظ الطلب")); qc.invalidateQueries({ queryKey: ["zatca-provider-app"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = async (docKey: string, file: File) => {
    if (!tenantId) return;
    if (file.size > 10 * 1024 * 1024) { toast.error(L("File must be under 10MB", "الملف يجب أن يكون أقل من 10MB")); return; }
    setUploading(docKey);
    try {
      const id = await ensureApp();
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${tenantId}/${docKey}/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from("zatca-application-docs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error } = await db.from("zatca_provider_application_documents").insert({
        application_id: id, tenant_id: tenantId, doc_key: docKey, file_path: path, file_name: file.name.slice(0, 200), file_size: file.size, uploaded_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success(L("Document uploaded", "تم رفع المستند"));
      qc.invalidateQueries({ queryKey: ["zatca-provider-docs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const openDoc = async (path: string) => {
    const { data, error } = await db.storage.from("zatca-application-docs").createSignedUrl(path, 300);
    if (error || !data) { toast.error(L("Could not open the file", "تعذر فتح الملف")); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const removeDoc = async (id: string) => {
    const { error } = await db.from("zatca_provider_application_documents").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: ["zatca-provider-docs"] });
  };

  const byKey = useMemo(() => {
    const m = new Map<string, DocRow[]>();
    for (const d of docs.data ?? []) m.set(d.doc_key, [...(m.get(d.doc_key) ?? []), d]);
    return m;
  }, [docs.data]);
  const required = FILE_GROUPS.flatMap((g) => g.docs);
  const have = required.filter((d) => byKey.has(d.id)).length;
  const fieldsDone = FIELDS.every(([k]) => (form[k] ?? "").trim());
  const allReady = have === required.length && fieldsDone;
  const status = app.data?.status ?? "draft";

  const statusBadge: Record<string, [string, string]> = {
    draft: ["Draft", "مسودة"], ready: ["Ready to submit", "جاهز للتقديم"], submitted: ["Submitted to ZATCA", "تم التقديم للهيئة"],
    under_review: ["Under review", "قيد المراجعة"], approved: ["Approved", "معتمد"], rejected: ["Rejected", "مرفوض"],
  };
  const dueCount = (applications.data ?? []).filter((a) => zatcaReminderDue(a)?.due).length;

  if (!tenantId) return <div className="p-6 text-sm text-muted-foreground">{L("Loading…", "جارٍ التحميل…")}</div>;

  return (
    <div dir={ar ? "rtl" : "ltr"} className="container mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold"><FileCheck2 className="h-6 w-6 text-primary" />{L("ZATCA provider application", "طلب اعتماد مزود حلول لدى الزكاة")}
          <Badge variant={status === "submitted" || status === "approved" ? "default" : "secondary"}>{L(...(statusBadge[status] ?? statusBadge.draft))}</Badge></h1>
        <p className="text-sm text-muted-foreground">{L("Fill in your company details and upload each document. Everything is saved to your account. ZATCA does not accept applications from other systems, so the final step is sending it on ZATCA's site — then record the reference number here.", "أدخل بيانات المنشأة وارفع كل مستند. يُحفظ كل شيء في حسابك. لا تستقبل الهيئة الطلبات من أنظمة أخرى، لذا تكون الخطوة الأخيرة التقديم عبر موقع الهيئة ثم تسجيل رقم الطلب هنا.")}</p>
      </div>

      <section className="space-y-3" aria-label={L("Application history", "سجل الطلبات")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{L("Application history", "سجل الطلبات")}{dueCount > 0 && <Badge variant="destructive" className="ms-2">{L(`${dueCount} need checking`, `${dueCount} بحاجة للمراجعة`)}</Badge>}</h2>
          <Button variant="outline" disabled={newApplication.isPending || applications.isLoading || save.isPending || !!uploading} onClick={() => newApplication.mutate()}>{L("New application", "طلب جديد")}</Button>
        </div>
        <div className="overflow-x-auto rounded-md border"><Table>
          <TableHeader><TableRow><TableHead>{L("Company / solution", "المنشأة / الحل")}</TableHead><TableHead>{L("Reference number", "رقم الطلب")}</TableHead><TableHead>{L("Submitted / created", "التقديم / الإنشاء")}</TableHead><TableHead>{L("Status", "الحالة")}</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{(applications.data ?? []).map((a) => <TableRow key={a.id} data-state={a.id === app.data?.id ? "selected" : undefined}>
            <TableCell><div className="font-medium">{a.company_name || L("Untitled application", "طلب بدون عنوان")}</div><div className="text-xs text-muted-foreground">{a.solution_name || "—"}</div></TableCell>
            <TableCell className="font-mono" dir="ltr">{a.zatca_reference || "—"}</TableCell>
            <TableCell className="whitespace-nowrap">{new Date(a.submitted_at ?? a.created_at).toLocaleDateString(ar ? "ar-SA-u-ca-gregory" : "en-GB", { timeZone: "Asia/Riyadh" })}</TableCell>
            <TableCell><div className="flex flex-wrap items-center gap-1"><Badge variant="outline">{L(...(statusBadge[a.status] ?? statusBadge.draft))}</Badge>
              {zatcaReminderDue(a)?.due && <Badge variant="destructive">{L("Check ZATCA", "راجع الهيئة")}</Badge>}</div>
              {a.decision_at && <div className="text-xs text-muted-foreground">{L("Decided", "القرار")} {new Date(a.decision_at).toLocaleDateString(ar ? "ar-SA-u-ca-gregory" : "en-GB", { timeZone: "Asia/Riyadh" })}</div>}</TableCell>
            <TableCell><Button variant="ghost" size="sm" disabled={save.isPending || !!uploading} onClick={() => setSelectedId(a.id)}>{L("View", "عرض")}</Button></TableCell>
          </TableRow>)}
          {!applications.data?.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{applications.isLoading ? L("Loading…", "جارٍ التحميل…") : applications.error ? L("Could not load applications", "تعذر تحميل الطلبات") : L("No applications yet", "لا توجد طلبات بعد")}</TableCell></TableRow>}
          </TableBody>
        </Table></div>
      </section>

      <Card><CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between text-sm"><span>{L("Documents uploaded", "المستندات المرفوعة")}</span><Badge variant={have === required.length ? "default" : "secondary"}>{have} / {required.length}</Badge></div>
        <Progress value={(have / required.length) * 100} />
      </CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{L("Company details", "بيانات المنشأة")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {FIELDS.map(([k, en, a]) => (
            <div key={k}><Label htmlFor={`zatca-${k}`}>{L(en, a)}</Label><Input id={`zatca-${k}`} value={form[k] ?? ""} maxLength={k === "vat_number" ? 15 : 300} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} /></div>
          ))}
          <div className="md:col-span-2"><Label>{L("Solution description", "وصف الحل")}</Label><Textarea rows={4} maxLength={4000} value={form.solution_description ?? ""} onChange={(e) => setForm((f) => ({ ...f, solution_description: e.target.value }))} /></div>
          <div className="md:col-span-2 flex justify-end"><Button onClick={() => save.mutate({})} disabled={save.isPending}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{L("Save", "حفظ")}</Button></div>
        </CardContent>
      </Card>

      {FILE_GROUPS.map((g) => (
        <Card key={g.en}>
          <CardHeader><CardTitle className="text-base">{L(g.en, g.ar)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {g.docs.map((d) => {
              const files = byKey.get(d.id) ?? [];
              return (
                <div key={d.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      {files.length > 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /> : <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                      <div><div className="font-medium">{L(d.en, d.ar)}</div><div className="text-sm text-muted-foreground">{L(d.noteEn, d.noteAr)}</div></div>
                    </div>
                    <label className="inline-flex">
                      <input type="file" className="sr-only" accept="image/*,application/pdf,.xml,.zip,.doc,.docx" disabled={uploading === d.id}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(d.id, f); e.target.value = ""; }} />
                      <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
                        {uploading === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{L("Upload", "رفع")}
                      </span>
                    </label>
                  </div>
                  {files.length > 0 && (
                    <ul className="mt-2 space-y-1 ps-6">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                          <button type="button" className="truncate text-primary hover:underline" onClick={() => openDoc(f.file_path)}>{f.file_name}</button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={L("Remove", "إزالة")} onClick={() => removeDoc(f.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle className="text-base">{L("Submit to ZATCA", "التقديم للهيئة")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!allReady && <p className="text-sm text-muted-foreground">{L("Fill in every company detail and upload every document first.", "أكمل بيانات المنشأة وارفع جميع المستندات أولاً.")}</p>}
          <ol className="list-decimal space-y-1 ps-5 text-sm">
            <li>{L("Open ZATCA's solution provider page and sign in with your company's account.", "افتح صفحة مزودي الحلول في الهيئة وسجّل الدخول بحساب المنشأة.")}</li>
            <li>{L("Copy the details above and attach the documents you uploaded here.", "انسخ البيانات أعلاه وأرفق المستندات التي رفعتها هنا.")}</li>
            <li>{L("Enter the reference number ZATCA gives you below.", "أدخل رقم الطلب الذي تمنحه الهيئة أدناه.")}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => {
              const text = [...FIELDS.map(([k, en]) => `${en}: ${form[k] ?? ""}`), `Solution description: ${form.solution_description ?? ""}`].join("\n");
              void navigator.clipboard.writeText(text).then(() => toast.success(L("Details copied", "تم نسخ البيانات")));
            }}>{L("Copy all details", "نسخ كل البيانات")}</Button>
            <Button variant="outline" disabled={!allReady} onClick={() => { save.mutate({ status: status === "draft" ? "ready" : status }); window.open(ZATCA_PORTAL, "_blank", "noopener"); }}>
              {L("Open ZATCA's site", "فتح موقع الهيئة")}<ExternalLink className="ms-2 h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
            <div><Label>{L("ZATCA reference number", "رقم الطلب لدى الهيئة")}</Label><Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></div>
            <Button disabled={!allReady || !reference.trim() || save.isPending}
              onClick={() => save.mutate({ status: "submitted", zatca_reference: reference.trim(), submitted_at: app.data?.submitted_at ?? new Date().toISOString() })}>
              <Send className="me-2 h-4 w-4" />{L("Mark as submitted", "تسجيل كمُقدَّم")}
            </Button>
          </div>
          {app.data?.submitted_at && <p className="text-sm text-muted-foreground">{L("Submitted on", "تاريخ التقديم")} {new Date(app.data.submitted_at).toLocaleDateString(i18n.language)}</p>}
          {app.data?.submitted_at && <ZatcaStatusTracker app={app.data} L={L} statusLabel={(s) => L(...(statusBadge[s] ?? statusBadge.draft))} portalUrl={ZATCA_PORTAL} locale={ar ? "ar-SA-u-ca-gregory" : "en-GB"} />}
          <div><Label>{L("Notes", "ملاحظات") }</Label><Textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} onBlur={() => app.data && save.mutate({})} /></div>
        </CardContent>
      </Card>
    </div>
  );
}
