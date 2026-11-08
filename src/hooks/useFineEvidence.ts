import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface FineEvidenceAttachment {
  id: string;
  restaurant_id: string;
  fine_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export const FINE_EVIDENCE_BUCKET = "fine-evidence";

/** Uploads a file to the private evidence bucket and returns its storage path. */
export async function uploadFineEvidenceFile(restaurantId: string, file: File) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${restaurantId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(FINE_EVIDENCE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return { path, safeName };
}

export async function openFineEvidence(path: string, download = false) {
  const { data, error } = await supabase.storage
    .from(FINE_EVIDENCE_BUCKET)
    .createSignedUrl(path, 120, download ? { download: true } : undefined);
  if (error || !data) {
    toast.error("Could not open evidence", { description: error?.message });
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export function useFineEvidence(fineId?: string | null) {
  const { restaurant, user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["fine-evidence", fineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fine_evidence_attachments")
        .select("*")
        .eq("fine_id", fineId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as FineEvidenceAttachment[];
    },
    enabled: !!fineId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fine-evidence"] });
    queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
  };

  const uploadFiles = useMutation({
    mutationFn: async ({ files, targetFineId }: { files: File[]; targetFineId?: string }) => {
      const id = targetFineId ?? fineId;
      if (!id) throw new Error("Missing fine reference");
      for (const file of files) {
        const { path, safeName } = await uploadFineEvidenceFile(restaurant!.id, file);
        const { error } = await supabase.from("fine_evidence_attachments").insert({
          restaurant_id: restaurant!.id,
          fine_id: id,
          storage_path: path,
          file_name: safeName,
          file_size: file.size,
          content_type: file.type || null,
          uploaded_by: user?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Evidence uploaded");
    },
    onError: (e: Error) => toast.error("Evidence upload failed", { description: e.message }),
  });

  const removeFile = useMutation({
    mutationFn: async (attachment: FineEvidenceAttachment) => {
      const { error } = await supabase
        .from("fine_evidence_attachments")
        .delete()
        .eq("id", attachment.id);
      if (error) throw error;
      await supabase.storage.from(FINE_EVIDENCE_BUCKET).remove([attachment.storage_path]);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Attachment removed");
    },
    onError: (e: Error) => toast.error("Could not remove attachment", { description: e.message }),
  });

  return {
    attachments: query.data ?? [],
    isLoading: query.isLoading,
    uploadFiles,
    removeFile,
  };
}
