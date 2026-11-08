import { motion } from "framer-motion";
import {
  ShieldCheck,
  Server,
  Lock,
  CreditCard,
  FileCheck,
  Globe,
  Database,
} from "lucide-react";
import { SaudiMadeBadge } from "./SaudiMadeBadge";
import { useLocaleText } from "@/hooks/useLocaleText";

interface ComplianceBadge {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  details: string[];
}

const badges: ComplianceBadge[] = [
  {
    icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.5} />,
    title: "ZATCA Phase 2",
    subtitle: "E-invoicing compliant",
    details: ["UBL 2.1 invoices", "Fatoora clearance", "Hash chain audit"],
  },
  {
    icon: <Server className="h-5 w-5" strokeWidth={1.5} />,
    title: "Saudi Hosted",
    subtitle: "Data residency guaranteed",
    details: ["KSA cloud regions", "Local failover", "Sub-50ms latency"],
  },
  {
    icon: <Lock className="h-5 w-5" strokeWidth={1.5} />,
    title: "PDPL Ready",
    subtitle: "Saudi data protection",
    details: ["Consent management", "Right to deletion", "Breach protocols"],
  },
  {
    icon: <CreditCard className="h-5 w-5" strokeWidth={1.5} />,
    title: "PCI DSS",
    subtitle: "Payment security standard",
    details: ["Tokenized cards", "Encrypted transmission", "Quarterly scans"],
  },
  {
    icon: <FileCheck className="h-5 w-5" strokeWidth={1.5} />,
    title: "SOC 2 Type II",
    subtitle: "Enterprise audit verified",
    details: ["Security controls", "Availability", "Confidentiality"],
  },
  {
    icon: <Database className="h-5 w-5" strokeWidth={1.5} />,
    title: "ISO 27001",
    subtitle: "Information security",
    details: ["Risk framework", "Access controls", "Annual certification"],
  },
];

function BadgeCard({ badge, index }: { badge: ComplianceBadge; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="group relative bg-card border border-border/60 rounded-lg p-5 hover:border-primary/30 hover:shadow-sm transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-10 w-10 rounded-full bg-primary/5 text-primary flex items-center justify-center group-hover:bg-primary/10 transition-colors">
          {badge.icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">
            {badge.title}
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">
            {badge.subtitle}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/40">
        <ul className="space-y-1.5">
          {badge.details.map((detail, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-[11px] text-gray-600"
            >
              <span className="h-1 w-1 rounded-full bg-primary/60 shrink-0" />
              {detail}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

export function ComplianceBadgesSection() {
  const tt = useLocaleText();
  const badges: ComplianceBadge[] = [
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.zatca.title", "ZATCA Phase 2"), subtitle: tt("landing.compliance.badges.zatca.subtitle", "E-invoicing compliant"), details: [tt("landing.compliance.badges.zatca.d1", "UBL 2.1 invoices"), tt("landing.compliance.badges.zatca.d2", "Fatoora clearance"), tt("landing.compliance.badges.zatca.d3", "Hash chain audit")] },
    { icon: <Server className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.hosted.title", "Saudi Hosted"), subtitle: tt("landing.compliance.badges.hosted.subtitle", "Data residency guaranteed"), details: [tt("landing.compliance.badges.hosted.d1", "KSA cloud regions"), tt("landing.compliance.badges.hosted.d2", "Local failover"), tt("landing.compliance.badges.hosted.d3", "Sub-50ms latency")] },
    { icon: <Lock className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.pdpl.title", "PDPL Ready"), subtitle: tt("landing.compliance.badges.pdpl.subtitle", "Saudi data protection"), details: [tt("landing.compliance.badges.pdpl.d1", "Consent management"), tt("landing.compliance.badges.pdpl.d2", "Right to deletion"), tt("landing.compliance.badges.pdpl.d3", "Breach protocols")] },
    { icon: <CreditCard className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.pci.title", "PCI DSS"), subtitle: tt("landing.compliance.badges.pci.subtitle", "Payment security standard"), details: [tt("landing.compliance.badges.pci.d1", "Tokenized cards"), tt("landing.compliance.badges.pci.d2", "Encrypted transmission"), tt("landing.compliance.badges.pci.d3", "Quarterly scans")] },
    { icon: <FileCheck className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.soc2.title", "SOC 2 Type II"), subtitle: tt("landing.compliance.badges.soc2.subtitle", "Enterprise audit verified"), details: [tt("landing.compliance.badges.soc2.d1", "Security controls"), tt("landing.compliance.badges.soc2.d2", "Availability"), tt("landing.compliance.badges.soc2.d3", "Confidentiality")] },
    { icon: <Database className="h-5 w-5" strokeWidth={1.5} />, title: tt("landing.compliance.badges.iso.title", "ISO 27001"), subtitle: tt("landing.compliance.badges.iso.subtitle", "Information security"), details: [tt("landing.compliance.badges.iso.d1", "Risk framework"), tt("landing.compliance.badges.iso.d2", "Access controls"), tt("landing.compliance.badges.iso.d3", "Annual certification")] },
  ];
  return (
    <section
      aria-label="Security and compliance certifications"
      className="border-y border-border/40 bg-white"
    >
      <div className="max-w-6xl mx-auto px-6 py-8 sm:py-10 lg:py-14">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-6 sm:mb-10"
        >
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/5 border border-primary/10 mb-4">
            <Globe className="h-3 w-3 text-primary" />
            <span className="text-[11px] font-medium text-primary tracking-wide">
              {tt("landing.compliance.eyebrow", "Built for the Kingdom")}
            </span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight">
            {tt("landing.compliance.title", "Saudi security, by design")}
          </h2>
          <p className="text-sm text-gray-600 mt-2 max-w-lg mx-auto leading-relaxed">
            {tt("landing.compliance.subtitle", "Every layer of Matbex is architected for Saudi regulatory requirements, from ZATCA e-invoicing to PDPL data residency.")}
          </p>
        </motion.div>

        {/* Saudi Made banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6 sm:mb-8 p-4 sm:p-5 rounded-xl bg-[#006C35]/[0.03] border border-[#006C35]/10"
        >
          <SaudiMadeBadge variant="full" />
          <div className="hidden sm:block h-8 w-px bg-[#006C35]/15" />
          <p className="text-sm text-gray-600 text-center sm:text-left max-w-md leading-relaxed">
            {tt("landing.compliance.saudiMadeNote", "Matbex is proudly designed, built, and operated in the Kingdom of Saudi Arabia - supporting local talent and Saudi Vision 2030.")}
          </p>
        </motion.div>

        {/* Badges grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Phones show the three headline certifications; the rest stay for wider screens. */}
          {badges.map((badge, i) => (
            <div key={badge.title} className={i >= 2 ? "hidden sm:block" : ""}>
              <BadgeCard badge={badge} index={i} />
            </div>
          ))}
        </div>

        {/* Bottom trust line */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-6 sm:mt-10 pt-6 sm:pt-8 border-t border-border/40 flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
              <Lock className="h-4 w-4 text-success" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">
                {tt("landing.compliance.encryptionTitle", "End-to-end encryption")}
              </p>
              <p className="text-[11px] text-gray-600">
                {tt("landing.compliance.encryptionSubtitle", "TLS 1.3 + AES-256-GCM at rest")}
              </p>
            </div>
          </div>

          <div className="hidden sm:block h-8 w-px bg-border/60" />

          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
              <Server className="h-4 w-4 text-success" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">
                {tt("landing.compliance.uptimeTitle", "99.99% uptime SLA")}
              </p>
              <p className="text-[11px] text-gray-600">
                {tt("landing.compliance.uptimeSubtitle", "Multi-region KSA failover")}
              </p>
            </div>
          </div>

          <div className="hidden sm:block h-8 w-px bg-border/60" />

          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
              <FileCheck className="h-4 w-4 text-success" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">
                {tt("landing.compliance.auditTitle", "Annual third-party audits")}
              </p>
              <p className="text-[11px] text-gray-600">
                {tt("landing.compliance.auditSubtitle", "Penetration testing + compliance review")}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
