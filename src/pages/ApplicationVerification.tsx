import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Check, ChevronRight, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { PageTransition } from "@/components/PageTransition";
import {
  ApplicationDocType,
  useApplicationVerification,
} from "@/hooks/useApplicationVerification";
import { DocumentUploadStep } from "@/components/verification/DocumentUploadStep";
import { OpeningHoursStep, OpeningHoursValue } from "@/components/verification/OpeningHoursStep";
import { UnderReviewScreen } from "@/components/onboarding";

type View = "welcome" | "checklist" | "submit" | ApplicationDocType;

const DOC_META: Record<ApplicationDocType, {
  label: string;
  title: string;
  description: string;
  acceptedFormats: string;
  acceptAttr: string;
  requirementsTitle?: string;
  requirements?: string[];
}> = {
  commercial_registration: {
    label: "Commercial registration",
    title: "Add Your Commercial Registration",
    description: "We need to verify your legal business registration.",
    acceptedFormats: ".pdf, .png, .jpg, .jpeg",
    acceptAttr: ".pdf,.png,.jpg,.jpeg",
  },
  tax_registration: {
    label: "Tax Registration Form",
    title: "Add Your Business Tax Registration Form",
    description: "We need to verify some information related to your establishment.",
    acceptedFormats: ".jpeg, .jpg, .png, .pdf",
    acceptAttr: ".jpeg,.jpg,.png,.pdf",
  },
  bank_iban: {
    label: "Bank proof",
    title: "Add your Bank Account Details (IBAN Certificate)",
    description: "We need to verify some information related to your establishment.",
    acceptedFormats: ".jpg, .png, .jpeg, .pdf, .tiff, .docx, .xlsx",
    acceptAttr: ".jpg,.png,.jpeg,.pdf,.tiff,.docx,.xlsx",
  },
  brand_logo: {
    label: "Brand Logo",
    title: "Upload your Brand Logo",
    description: "This is the logo that will appear on your storefront for customers.",
    acceptedFormats: ".pdf, .png, .jpg, .jpeg",
    acceptAttr: ".pdf,.png,.jpg,.jpeg",
    requirementsTitle: "Logo Requirements",
    requirements: [
      "Dimensions of 800 × 800 pixels",
      "High quality — not scanned, pixelated, or blurry",
      "Should include the shape, the name, or both",
      "Must be complete and not cropped",
      "A solid, single-color background is recommended",
      "Should be owned by your brand",
    ],
  },
  cover_photo: {
    label: "Cover photo",
    title: "Upload Cover Photo",
    description: "Attract customers and give them a clear idea of the food you offer.",
    acceptedFormats: ".pdf, .png, .jpg, .jpeg",
    acceptAttr: ".pdf,.png,.jpg,.jpeg",
    requirementsTitle: "Cover Photo Requirements",
    requirements: [
      "Dimensions: 1500 × 750 pixels (landscape)",
      "Must not include faces or hands",
      "Prices should not appear in the image",
      "No contact details (phone numbers, etc.)",
      "Theme must align with your cuisine",
      "Any dish shown must be from the actual menu",
      "A logo may be included if it does not exceed 20% of the image",
    ],
  },
  dine_in_menu: {
    label: "Dine-in menu",
    title: "Upload your Dine-in Menu",
    description: "Share your current dine-in menu so our team can review it.",
    acceptedFormats: ".pdf, .png, .jpg, .jpeg, .docx",
    acceptAttr: ".pdf,.png,.jpg,.jpeg,.docx",
  },
  opening_hours: {
    label: "Opening hours",
    title: "Opening Hours",
    description: "Set your weekly opening hours.",
    acceptedFormats: "",
    acceptAttr: "",
  },
};

const DOC_ORDER: ApplicationDocType[] = [
  "commercial_registration",
  "tax_registration",
  "bank_iban",
  "brand_logo",
  "cover_photo",
  "dine_in_menu",
  "opening_hours",
];

export default function ApplicationVerification() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const email = params.get("email");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("welcome");

  const { application, documents, loading, error, upload, remove, saveOpeningHours, submit } =
    useApplicationVerification(id ?? null, email);

  const docsByType = useMemo(() => {
    const map = new Map<ApplicationDocType, typeof documents[number]>();
    documents.forEach((d) => map.set(d.doc_type, d));
    return map;
  }, [documents]);

  const completedCount = DOC_ORDER.filter((t) => docsByType.has(t)).length;
  const progress = (completedCount / DOC_ORDER.length) * 100;

  if (!id || !email) {
    return (
      <PageTransition className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center space-y-3">
          <h2 className="text-xl font-semibold">Missing application info</h2>
          <p className="text-sm text-muted-foreground">
            Your verification link is invalid. Please reopen the link from the email we sent you.
          </p>
          <Button onClick={() => navigate("/register")}>Back to sign up</Button>
        </Card>
      </PageTransition>
    );
  }

  if (loading && !application) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <PageTransition className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center space-y-3">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </Card>
      </PageTransition>
    );
  }

  if (application && ["pending_approval", "approved", "rejected"].includes(application.status)) {
    return <UnderReviewScreen email={email} applicationId={id} />;
  }

  const handleSubmit = async () => {
    try {
      await submit();
      toast.success("Application submitted for review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    }
  };

  return (
    <PageTransition className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <MatbexLogo size="sm" animate={false} />
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>{completedCount} of {DOC_ORDER.length} steps complete</span>
          </div>
        </div>
        <Progress value={progress} className="h-0.5 rounded-none" />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10">
        {view === "welcome" && (
          <WelcomeView onContinue={() => setView("checklist")} email={email} completedCount={completedCount} />
        )}

        {view === "checklist" && (
          <ChecklistView
            docsByType={docsByType}
            onOpen={(t) => setView(t)}
            onSubmit={() => setView("submit")}
            allComplete={completedCount === DOC_ORDER.length}
          />
        )}

        {view !== "welcome" && view !== "checklist" && view !== "submit" && (
          <div className="space-y-6">
            <Button variant="ghost" onClick={() => setView("checklist")} className="-ml-3 text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to checklist
            </Button>

            {view === "opening_hours" ? (
              <OpeningHoursStep
                initial={application?.opening_hours ?? null}
                saved={docsByType.has("opening_hours")}
                onSave={async (val: OpeningHoursValue) => {
                  await saveOpeningHours(val);
                  toast.success("Opening hours saved");
                  setView("checklist");
                }}
              />
            ) : (
              <DocumentUploadStep
                {...DOC_META[view]}
                doc={docsByType.get(view)}
                onUpload={async (file) => {
                  await upload(view, file);
                  toast.success("File uploaded");
                }}
                onDelete={async () => {
                  await remove(view);
                  toast.success("File removed");
                }}
              />
            )}
          </div>
        )}

        {view === "submit" && (
          <SubmitView completedCount={completedCount} total={DOC_ORDER.length} onSubmit={handleSubmit} onBack={() => setView("checklist")} />
        )}
      </main>
    </PageTransition>
  );
}

function WelcomeView({
  onContinue,
  email,
  completedCount,
}: {
  onContinue: () => void;
  email: string;
  completedCount: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div>
        <p className="text-primary text-[14px] font-medium tracking-wide mb-2">Welcome</p>
        <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-foreground leading-[1.15]">
          Thank you for signing up
        </h1>
        <p className="text-[15px] text-muted-foreground leading-[1.65] mt-3 max-w-xl">
          Congratulations! You have successfully registered with us as <span className="font-medium text-foreground">{email}</span>. Below you will see the required details we need from you.
        </p>
      </div>

      <Card className="divide-y">
        <StepRow num={1} title="Add your business" subtitle="Completed during signup" completed />
        <StepRow num={2} title="Verify your business" subtitle="Upload verification documents" completed={completedCount === DOC_ORDER.length} />
        <StepRow num={3} title="Wait for approval" subtitle="Our team reviews within 24-48h" />
        <StepRow num={4} title="Open your business" subtitle="Start serving customers" />
      </Card>

      <div className="flex justify-end">
        <Button onClick={onContinue} className="bg-primary">
          Continue
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </motion.div>
  );
}

function StepRow({
  num,
  title,
  subtitle,
  completed,
}: {
  num: number;
  title: string;
  subtitle: string;
  completed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-[13px] text-primary font-medium">Step {num}</p>
        <p className="text-[15px] font-medium text-foreground mt-0.5">{title}</p>
        <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      {completed && (
        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-100">
          <Check className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      )}
    </div>
  );
}

function ChecklistView({
  docsByType,
  onOpen,
  onSubmit,
  allComplete,
}: {
  docsByType: Map<ApplicationDocType, unknown>;
  onOpen: (t: ApplicationDocType) => void;
  onSubmit: () => void;
  allComplete: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div>
        <p className="text-primary text-[14px] font-medium tracking-wide mb-2">Step 2</p>
        <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-foreground leading-[1.15]">
          Verify your business
        </h1>
        <p className="text-[15px] text-muted-foreground leading-[1.65] mt-3 max-w-xl">
          We need a few documents to verify your identity and business. Once we have them we'll review and get back as soon as we can.
        </p>
      </div>

      <div>
        <p className="text-[14px] font-medium text-foreground mb-3">What do we need from you</p>
        <Card className="divide-y">
          {DOC_ORDER.map((t) => {
            const meta = DOC_META[t];
            const done = docsByType.has(t);
            return (
              <button
                key={t}
                onClick={() => onOpen(t)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      done ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : <span className="text-[11px]">•</span>}
                  </span>
                  <span className="text-[15px] font-medium text-foreground">{meta.label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            );
          })}
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSubmit} className="bg-primary" disabled={!allComplete}>
          {allComplete ? "Submit for review" : "Complete all steps to submit"}
        </Button>
      </div>
    </motion.div>
  );
}

function SubmitView({
  completedCount,
  total,
  onSubmit,
  onBack,
}: {
  completedCount: number;
  total: number;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-8 text-center space-y-4 max-w-lg mx-auto">
      <h2 className="text-2xl font-semibold tracking-tight">Ready to submit?</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        You've completed {completedCount} of {total} verification steps. Our team will review your documents and reach out within 24-48 hours.
      </p>
      <div className="flex justify-center gap-2 pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={async () => {
            setBusy(true);
            try { await onSubmit(); } finally { setBusy(false); }
          }}
          disabled={busy}
          className="bg-primary"
        >
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Submit application
        </Button>
      </div>
    </Card>
  );
}