import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { leadAttributionPayload, trackAdLead } from "@/lib/adConsent";
import { Mail, MapPin, Phone, Send } from "lucide-react";
import { useEnquiryFormTracker } from "@/hooks/useEnquiryFormTracker";
import { CONTACT } from "@/data/contact";

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name")
    .max(100, "Name must be under 100 characters"),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email")
    .max(255, "Email must be under 255 characters"),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a bit more (at least 10 characters)")
    .max(2000, "Message must be under 2000 characters"),
});

/** Pricing page links arrive as ?plan=Growth%20Bundle&billing=annual. */
function planPrefill() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan");
  if (!plan) return "";
  const billing = params.get("billing");
  const cycle = billing === "monthly" || billing === "annual" ? ` on ${billing} billing` : "";
  return `I'd like to start on the ${plan.slice(0, 60)} plan${cycle}. Here is a bit about my venue: `;
}

export function ContactSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(planPrefill);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const trackForm = useEnquiryFormTracker(formRef);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = contactSchema.safeParse({ name, email, message });
    if (!parsed.success) {
      trackForm("error", false);
      toast.error(parsed.error.issues[0]?.message ?? "Please review the form");
      return;
    }
    setSubmitting(true);
    const params = new URLSearchParams(window.location.search);
    const { data, error } = await db.functions.invoke("send-contact-enquiry", {
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        message: parsed.data.message,
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
      trackForm("error", false);
      toast.error(
        serverError ?? "Could not send your message. Please try again.",
      );
      return;
    }
    const leadId = (data as { id?: string } | null)?.id;
    if (leadId) void trackAdLead("Lead", leadId);
    trackForm("submit", false);
    setSent(true);
    setName("");
    setEmail("");
    setMessage("");
    navigate("/contact/thank-you");
  }


  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="relative overflow-hidden bg-gray-50 border-t border-gray-200"
    >
      {/* Closing chapter: one pool of service light behind the final ask */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.18),transparent_70%)] blur-2xl"
      />
      <div className="relative max-w-3xl mx-auto px-6 py-12 sm:py-16 md:py-20">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-gray-200 text-xs font-medium text-gray-700 mb-5">
            <Mail className="w-3.5 h-3.5 text-[#00A859]" />
            Get in touch
          </div>
          <h2
            id="contact-heading"
            className="text-3xl md:text-4xl font-light tracking-tight text-gray-900 mb-4"
          >
            Talk to the team
          </h2>
          <p className="text-base md:text-lg leading-relaxed text-gray-600 font-light max-w-xl mx-auto">
            Have a question about pricing, onboarding, or whether Matbex fits your
            kitchen? Send us a note and we'll reply within one business day.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-600 font-light">
            <a
              href={`mailto:${CONTACT.email}`}
              className="inline-flex items-center gap-1.5 min-h-11 hover:text-gray-900 transition-colors"
            >
              <Mail className="w-4 h-4 text-[#00A859]" aria-hidden />
              {CONTACT.email}
            </a>
            {CONTACT.phone && (
              <a
                href={`tel:${CONTACT.phone.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-1.5 min-h-11 hover:text-gray-900 transition-colors"
              >
                <Phone className="w-4 h-4 text-[#00A859]" aria-hidden />
                {CONTACT.phone}
              </a>
            )}
            <span className="inline-flex items-center gap-1.5 min-h-11">
              <MapPin className="w-4 h-4 text-[#00A859]" aria-hidden />
              {CONTACT.address}
            </span>
          </div>
        </div>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onFocusCapture={() => trackForm("start")}
          className="relative bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm space-y-5"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#00A859]/50 to-transparent"
          />

          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="contact-name" className="text-sm font-medium text-gray-800">
                Name
              </Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                maxLength={100}
                autoComplete="name"
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email" className="text-sm font-medium text-gray-800">
                Email
              </Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                maxLength={255}
                autoComplete="email"
                required
                disabled={submitting}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-message" className="text-sm font-medium text-gray-800">
              Message
            </Label>
            <Textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us about your restaurant and what you'd like to know."
              rows={5}
              maxLength={2000}
              required
              disabled={submitting}
              className="leading-relaxed"
            />
            <p className="text-xs text-gray-500 text-right">
              {message.length}/2000
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <p className="text-xs text-gray-500 leading-relaxed">
              By submitting, you agree to be contacted by the Matbex team. We never
              share your details.
            </p>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#00A859] hover:bg-[#00A859]/90 text-white min-h-11 h-11 px-6 gap-2 w-full sm:w-auto"
            >
              <Send className="w-4 h-4" />
              {submitting ? "Sending..." : sent ? "Send another" : "Send message"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default ContactSection;