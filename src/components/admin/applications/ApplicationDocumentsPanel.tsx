import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, X, ExternalLink, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { ApplicationDocType } from "@/hooks/useApplicationVerification";

interface Doc {
  id: string;
  doc_type: ApplicationDocType;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_note: string | null;
}

const LABELS: Record<ApplicationDocType, string> = {
  commercial_registration: "Commercial Registration",
  tax_registration: "Tax Registration",
  bank_iban: "Bank / IBAN",
  brand_logo: "Brand Logo",
  cover_photo: "Cover Photo",
  dine_in_menu: "Dine-in Menu",
  opening_hours: "Opening Hours",
};

export function ApplicationDocumentsPanel({ applicationId }: { applicationId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingHours, setOpeningHours] = useState<Record<string, unknown> | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    // Bucket is private; fetch fresh signed URLs via edge function.
    const { data, error } = await supabase.functions.invoke("application-verification?action=admin-list", {
      body: { applicationId },
    });
    if (error) {
      setDocs([]);
      setOpeningHours(null);
      setLoading(false);
      return;
    }
    const payload = data as { documents?: Doc[]; application?: { opening_hours?: Record<string, unknown> | null } };
    setDocs((payload?.documents ?? []) as Doc[]);
    setOpeningHours((payload?.application?.opening_hours as Record<string, unknown> | null) ?? null);
    setLoading(false);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [applicationId]);

  const review = async (doc: Doc, status: "approved" | "rejected") => {
    setBusyId(doc.id);
    try {
      const { error } = await supabase
        .from("application_documents")
        .update({
          status,
          reviewer_note: noteDraft[doc.id] ?? doc.reviewer_note,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      if (error) throw error;
      toast.success(`Document ${status}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No documents uploaded yet.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {docs.map((d) => {
        const isHours = d.doc_type === "opening_hours";
        const isImage = d.mime_type?.startsWith("image/");
        return (
          <Card key={d.id} className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {isImage ? (
                  <ImageIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                ) : (
                  <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{LABELS[d.doc_type]}</p>
                  {!isHours && (
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-emerald-600 hover:underline flex items-center gap-1 truncate"
                    >
                      {d.file_name}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <Badge
                className={
                  d.status === "approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : d.status === "rejected"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning"
                }
              >
                {d.status}
              </Badge>
            </div>

            {isImage && (
              <img src={d.file_url} alt={d.file_name} className="rounded-md border max-h-48 object-contain bg-muted/30" />
            )}

            {isHours && openingHours && (
              <div className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(openingHours).map(([day, v]) => {
                  const dv = v as { open: boolean; from: string; to: string };
                  return (
                    <div key={day} className="bg-muted/40 px-2 py-1 rounded">
                      <span className="font-medium capitalize">{day}</span>:{" "}
                      {dv.open ? `${dv.from} – ${dv.to}` : "Closed"}
                    </div>
                  );
                })}
              </div>
            )}

            <Textarea
              placeholder="Reviewer note (shown to applicant if rejected)"
              defaultValue={d.reviewer_note ?? ""}
              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [d.id]: e.target.value }))}
              rows={2}
              className="text-xs"
            />

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => review(d, "rejected")}
                disabled={busyId === d.id}
                className="text-destructive hover:text-destructive/80"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                onClick={() => review(d, "approved")}
                disabled={busyId === d.id}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                Approve
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}