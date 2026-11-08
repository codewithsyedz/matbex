import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { leadAttributionPayload, trackAdLead } from "@/lib/adConsent";
import { ArrowRight, Loader2 } from "lucide-react";

const BRANCH_OPTIONS = ["1 branch", "2–3 branches", "4–9 branches", "10+ branches"];

const signupSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(100, "Name must be under 100 characters"),
  email: z.string().trim().email("Please enter a valid email").max(255, "Email must be under 255 characters"),
  company: z.string().trim().min(1, "Please enter your restaurant name").max(120, "Restaurant name is too long"),
  phone: z.string().trim().max(40, "Phone number is too long"),
  notes: z.string().trim().max(1500, "Please keep notes under 1500 characters"),
});

interface PricingSignupFormProps {
  /** Plan names available to choose from, in display order. */
  planNames: string[];
  /** Currently chosen plan, controlled by the pricing page. */
  selectedPlan: string;
  onSelectPlan: (plan: string) => void;
  billing: "monthly" | "annual";
  onSelectBilling: (billing: "monthly" | "annual") => void;
}

/**
 * On-page signup for the pricing page. Submissions go through the same
 * enquiry function as the home page form, so they land in the admin inbox
 * with the chosen plan, billing cycle and branch count attached.
 */
export function PricingSignupForm({
  planNames,
  selectedPlan,
  onSelectPlan,
  billing,
  onSelectBilling,
}: PricingSignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [branchCount, setBranchCount] = useState(BRANCH_OPTIONS[0]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);

  // A plan may only load after the first render; keep the choice valid.
  useEffect(() => {
    if (!selectedPlan && planNames.length > 0) onSelectPlan(planNames[0]);
  }, [planNames, selectedPlan, onSelectPlan]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signupSchema.safeParse({ name, email, company, phone, notes });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please review the form");
      return;
    }

    const plan = selectedPlan || planNames[0] || "Not selected";
    const message = [
      `Plan signup request: ${plan} (${billing} billing).`,
      `Restaurant: ${parsed.data.company}`,
      `Branches: ${branchCount}`,
      parsed.data.phone ? `Phone: ${parsed.data.phone}` : null,
      parsed.data.notes ? `\nNotes: ${parsed.data.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitting(true);
    const params = new URLSearchParams(window.location.search);
    const { data, error } = await supabase.functions.invoke("send-contact-enquiry", {
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        message,
        company: parsed.data.company,
        phone: parsed.data.phone || null,
        branchCount,
        sourcePath: window.location.pathname,
        referrer: document.referrer || null,
        utmSource: params.get("utm_source"),
        utmCampaign: params.get("utm_campaign"),
        language: document.documentElement.lang || null,
        attribution: await leadAttributionPayload(),
      },
    });
    setSubmitting(false);

    const serverError = (data as { error?: string } | null)?.error;
    if (error || serverError) {
      toast.error(serverError ?? "Could not send your request. Please try again.");
      return;
    }
    const leadId = (data as { id?: string } | null)?.id;
    if (leadId) void trackAdLead("Lead", leadId);
    navigate("/contact/thank-you");
  }

  const fieldClass =
    "w-full min-h-11 rounded-lg border border-white/12 bg-white/[0.04] px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-[#00A859]/60 focus:bg-white/[0.06]";

  return (
    <section
      id="signup"
      ref={sectionRef}
      aria-labelledby="pricing-signup-heading"
      className="relative border-t border-white/10 scroll-mt-24"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[720px] max-w-[140vw] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.14),transparent_70%)] blur-2xl"
      />
      <div className="relative max-w-3xl mx-auto w-full px-6 py-14 sm:py-20">
        <div className="text-center mb-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-3">Sign up</p>
          <h2
            id="pricing-signup-heading"
            className="text-2xl md:text-3xl font-light tracking-tight text-white mb-4"
          >
            Choose your plan and we'll set it up
          </h2>
          <p className="text-base font-light leading-relaxed text-white/55">
            Send this and our team confirms your branch count, your first invoice and an onboarding
            date — usually within one business day.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-6"
        >
          {/* Plan */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-white/80 mb-3">Your plan</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {planNames.map((plan) => {
                const active = plan === selectedPlan;
                return (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => onSelectPlan(plan)}
                    aria-pressed={active}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${
                      active
                        ? "border-[#00A859]/60 bg-[#00A859]/15 text-white"
                        : "border-white/12 text-white/60 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {plan}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Billing */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-white/80 mb-3">Billing</legend>
            <div className="inline-flex items-center gap-1 rounded-xl border border-white/12 bg-white/[0.04] p-1">
              {(["monthly", "annual"] as const).map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => onSelectBilling(cycle)}
                  aria-pressed={billing === cycle}
                  className={`min-h-11 rounded-lg px-5 text-sm font-medium capitalize transition-colors ${
                    billing === cycle ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
                  }`}
                >
                  {cycle}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40">
              Prices exclude VAT. Annual billing is invoiced once for twelve months.
            </p>
          </fieldset>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="signup-name" className="block text-sm font-medium text-white/80">
                Your name
              </label>
              <input
                id="signup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                autoComplete="name"
                placeholder="Full name"
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-email" className="block text-sm font-medium text-white/80">
                Work email
              </label>
              <input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                required
                autoComplete="email"
                placeholder="you@restaurant.com"
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-company" className="block text-sm font-medium text-white/80">
                Restaurant name
              </label>
              <input
                id="signup-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={120}
                required
                autoComplete="organization"
                placeholder="Your venue"
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-phone" className="block text-sm font-medium text-white/80">
                Phone <span className="text-white/35">(optional)</span>
              </label>
              <input
                id="signup-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
                autoComplete="tel"
                placeholder="+966 …"
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-branches" className="block text-sm font-medium text-white/80">
                Branches
              </label>
              <select
                id="signup-branches"
                value={branchCount}
                onChange={(e) => setBranchCount(e.target.value)}
                className={`${fieldClass} appearance-none`}
              >
                {BRANCH_OPTIONS.map((option) => (
                  <option key={option} value={option} className="bg-[#0B0C0E] text-white">
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="signup-notes" className="block text-sm font-medium text-white/80">
              Anything we should know? <span className="text-white/35">(optional)</span>
            </label>
            <textarea
              id="signup-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1500}
              rows={4}
              placeholder="Current system, go-live date, number of tills…"
              className={`${fieldClass} min-h-28 py-3 resize-y leading-relaxed`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#00A859] px-6 text-sm font-medium text-white transition-colors hover:bg-[#00A859]/90 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                Sign up for {selectedPlan || "Matbex"}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
          <p className="text-center text-xs text-white/40">
            No card needed now. We confirm the details before any invoice is raised.
          </p>
        </form>
      </div>
    </section>
  );
}
