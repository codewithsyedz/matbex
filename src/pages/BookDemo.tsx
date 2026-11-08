import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { CalendarClock, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { leadAttributionPayload, trackAdLead } from "@/lib/adConsent";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

const SLOTS = [
  "09:00 – 10:00",
  "10:00 – 11:00",
  "11:00 – 12:00",
  "13:00 – 14:00",
  "14:00 – 15:00",
  "15:00 – 16:00",
  "16:00 – 17:00",
  "20:00 – 21:00",
];

const BRANCH_OPTIONS = ["1 branch", "2–3 branches", "4–9 branches", "10+ branches"];

const demoSchema = (ar: boolean) => z.object({
  name: z.string().trim().min(1, ar ? "يرجى إدخال اسمك" : "Please enter your name").max(100, ar ? "يجب ألا يتجاوز الاسم ١٠٠ حرف" : "Name must be under 100 characters"),
  email: z.string().trim().email(ar ? "يرجى إدخال بريد إلكتروني صحيح" : "Please enter a valid email").max(255, ar ? "يجب ألا يتجاوز البريد الإلكتروني ٢٥٥ حرفًا" : "Email must be under 255 characters"),
  company: z.string().trim().min(1, ar ? "يرجى إدخال اسم المطعم" : "Please enter your restaurant name").max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  branchCount: z.string().trim().max(40),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ar ? "يرجى اختيار التاريخ" : "Please choose a date"),
  preferredSlot: z.string().trim().min(1, ar ? "يرجى اختيار الوقت" : "Please choose a time"),
  message: z.string().trim().max(2000, ar ? "يجب ألا تتجاوز الملاحظات ٢٠٠٠ حرف" : "Notes must be under 2000 characters"),
});

const inputClass =
  "bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:ring-ring";

export default function BookDemo() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const copy = (en: string, arabic: string) => ar ? arabic : en;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
    branchCount: BRANCH_OPTIONS[0],
    preferredDate: "",
    preferredSlot: SLOTS[0],
    message: "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = demoSchema(ar).safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? copy("Please review the form", "يرجى مراجعة بيانات النموذج"));
      return;
    }
    setSubmitting(true);
    const params = new URLSearchParams(window.location.search);
    try {
    const { data, error } = await supabase.functions.invoke("send-contact-enquiry", {
      body: {
        ...parsed.data,
        kind: "demo",
        sourcePath: window.location.pathname,
        referrer: document.referrer || null,
        utmSource: params.get("utm_source"),
        utmCampaign: params.get("utm_campaign"),
        language: ar ? "ar" : "en",
        attribution: await leadAttributionPayload(),
      },
    });
    setSubmitting(false);

    const serverError = (data as { error?: string } | null)?.error;
    if (error || serverError) {
      toast.error(ar ? "تعذّر إرسال طلب العرض. يرجى المحاولة مرة أخرى." : serverError ?? "Could not book your demo. Please try again.");
      return;
    }
    const leadId = (data as { id?: string } | null)?.id;
    if (leadId) void trackAdLead("Lead", leadId);
    navigate("/contact/thank-you");
    } catch {
      toast.error(copy("Could not book your demo. Please try again.", "تعذّر إرسال طلب العرض. يرجى المحاولة مرة أخرى."));
    } finally {
      setSubmitting(false);
    }
  }

  const title = copy("Book a Live Demo | Matbex Restaurant Operating System", "احجز عرضًا مباشرًا | مطبخ — نظام إدارة المطاعم");
  const description =
    copy("Schedule a 30-minute live demo of Matbex with our team — POS, ZATCA e-invoicing, inventory, COGS, payroll and daily profit, walked through on your own numbers.", "احجز عرضًا مباشرًا لمدة ٣٠ دقيقة مع فريق مطبخ لاستكشاف نقاط البيع والفوترة الإلكترونية والمخزون وتكاليف الطعام والرواتب والأرباح اليومية.");

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/demo" />
      <MarketingShell>
        <LandingHeader />
        <MarketingPageHero
          eyebrow={copy("Live demo", "عرض مباشر")}
          title={copy("Book a live demo with the team", "احجز عرضًا مباشرًا مع فريق مطبخ")}
          summary={copy("Thirty minutes, screen shared, using your menu and your costs. Pick a slot and we confirm by email within one business day.", "٣٠ دقيقة عبر مشاركة الشاشة، باستخدام قائمة مطعمك وتكاليفه. اختر الموعد المناسب وسنؤكده عبر البريد الإلكتروني خلال يوم عمل واحد.")}
          crumbs={[{ label: copy("Home", "الرئيسية"), to: "/" }, { label: copy("Book a demo", "احجز عرضًا") }]}
          note={copy("All times shown in Riyadh time (GMT+3).", "جميع المواعيد بتوقيت الرياض (GMT+3).")}
        />

        <main dir={ar ? "rtl" : "ltr"} lang={ar ? "ar" : "en"} className="flex-1 w-full">
          <section className="max-w-3xl mx-auto w-full px-6 py-14 sm:py-16">
            <MarketingReveal>
              <form
                onSubmit={handleSubmit}
                className="rounded-lg border border-border bg-card p-6 sm:p-8 space-y-5"
                aria-labelledby="demo-form-heading"
              >
                <h2 id="demo-form-heading" className="text-xl font-medium text-foreground">
                  {copy("Choose your slot", "اختر موعدك")}
                </h2>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="demo-name" className="text-muted-foreground">{copy("Your name", "الاسم")}</Label>
                    <Input
                      id="demo-name"
                      value={form.name}
                      onChange={(e) => set("name")(e.target.value)}
                      maxLength={100}
                      required
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-email" className="text-muted-foreground">{copy("Work email", "البريد الإلكتروني للعمل")}</Label>
                    <Input
                      id="demo-email"
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={(e) => set("email")(e.target.value)}
                      maxLength={255}
                      required
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-company" className="text-muted-foreground">{copy("Restaurant name", "اسم المطعم")}</Label>
                    <Input
                      id="demo-company"
                      value={form.company}
                      onChange={(e) => set("company")(e.target.value)}
                      maxLength={120}
                      required
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-phone" className="text-muted-foreground">{copy("Phone (optional)", "رقم الجوال (اختياري)")}</Label>
                    <Input
                      id="demo-phone"
                      type="tel"
                      dir="ltr"
                      value={form.phone}
                      onChange={(e) => set("phone")(e.target.value)}
                      maxLength={40}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-branches" className="text-muted-foreground">{copy("How many branches?", "كم عدد فروع مطعمك؟")}</Label>
                    <select
                      id="demo-branches"
                      value={form.branchCount}
                      onChange={(e) => set("branchCount")(e.target.value)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {BRANCH_OPTIONS.map((o) => (
                        <option key={o} value={o} className="bg-background">{ar ? ["فرع واحد", "فرعان إلى ٣ فروع", "٤ إلى ٩ فروع", "١٠ فروع أو أكثر"][BRANCH_OPTIONS.indexOf(o)] : o}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-date" className="text-muted-foreground">{copy("Preferred date", "التاريخ المفضل")}</Label>
                    <Input
                      id="demo-date"
                      type="date"
                      min={minDate}
                      value={form.preferredDate}
                      onChange={(e) => set("preferredDate")(e.target.value)}
                      required
                      className={`${inputClass} [color-scheme:light] dark:[color-scheme:dark]`}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="demo-slot" className="text-muted-foreground">{copy("Preferred time (Riyadh)", "الوقت المفضل (بتوقيت الرياض)")}</Label>
                    <select
                      id="demo-slot"
                      dir="ltr"
                      value={form.preferredSlot}
                      onChange={(e) => set("preferredSlot")(e.target.value)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {SLOTS.map((s) => (
                        <option key={s} value={s} className="bg-background">{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="demo-message" className="text-muted-foreground">
                    {copy("Anything you want us to focus on? (optional)", "ما الذي ترغب في التركيز عليه؟ (اختياري)")}
                  </Label>
                  <Textarea
                    id="demo-message"
                    rows={4}
                    maxLength={2000}
                    value={form.message}
                    onChange={(e) => set("message")(e.target.value)}
                    placeholder={copy("e.g. COGS on a weekly stocktake, ZATCA e-invoicing, payroll for 20 staff", "مثل: تكلفة الطعام عند الجرد الأسبوعي، الفوترة الإلكترونية، رواتب ٢٠ موظفًا")}
                    className={inputClass}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="min-h-11 w-full gap-2 sm:w-auto"
                >
                  {submitting ? copy("Booking…", "جارٍ إرسال الطلب…") : copy("Request this slot", "اطلب هذا الموعد")}
                  {submitting ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                </Button>
                <p className="text-xs font-medium text-foreground/45">
                  {copy("We only use your details to arrange the demo. No card required.", "نستخدم بياناتك لترتيب العرض فقط. لا تحتاج إلى بطاقة دفع.")}
                </p>
              </form>
            </MarketingReveal>
          </section>
        </main>

        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
}
