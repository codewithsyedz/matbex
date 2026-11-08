import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export const COMPLIANCE_EVIDENCE_BUCKET = "compliance-evidence";

export type EvidencePhase = "before" | "after";

export interface ComplianceEvidence {
  id: string;
  restaurant_id: string;
  violation_id: string;
  phase: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export async function uploadComplianceFile(restaurantId: string, file: File, prefix = "violations") {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${restaurantId}/${prefix}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(COMPLIANCE_EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export async function openComplianceFile(path: string) {
  const { data, error } = await supabase.storage
    .from(COMPLIANCE_EVIDENCE_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data) {
    toast.error("Could not open file", { description: error?.message });
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export function useComplianceEvidence(violationId?: string | null) {
  const { restaurant } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["compliance-evidence", violationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_violation_evidence")
        .select("*")
        .eq("violation_id", violationId!)
        .order("uploaded_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ComplianceEvidence[];
    },
    enabled: !!violationId,
  });

  const upload = useMutation({
    mutationFn: async ({
      files,
      phase,
      targetId,
    }: {
      files: File[];
      phase: EvidencePhase;
      targetId?: string;
    }) => {
      const id = targetId ?? violationId;
      if (!id) throw new Error("Missing violation reference");
      for (const file of files) {
        const path = await uploadComplianceFile(restaurant!.id, file);
        const { error } = await supabase.from("compliance_violation_evidence").insert({
          restaurant_id: restaurant!.id,
          violation_id: id,
          phase,
          storage_path: path,
          caption: file.name,
        } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-evidence"] });
      toast.success("Photo uploaded");
    },
    onError: (e: Error) => toast.error("Upload failed", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (row: ComplianceEvidence) => {
      const { error } = await supabase
        .from("compliance_violation_evidence")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      await supabase.storage.from(COMPLIANCE_EVIDENCE_BUCKET).remove([row.storage_path]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-evidence"] });
      toast.success("Photo removed");
    },
    onError: (e: Error) => toast.error("Could not remove photo", { description: e.message }),
  });

  const rows = query.data ?? [];
  return {
    before: rows.filter((r) => r.phase === "before"),
    after: rows.filter((r) => r.phase === "after"),
    isLoading: query.isLoading,
    upload,
    remove,
  };
}