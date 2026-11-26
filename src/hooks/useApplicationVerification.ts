import { useCallback, useEffect, useState } from "react";
import { db } from "@/integrations/db/client";

export type ApplicationDocType =
  | "commercial_registration"
  | "tax_registration"
  | "bank_iban"
  | "brand_logo"
  | "cover_photo"
  | "dine_in_menu"
  | "opening_hours";

export interface ApplicationDocument {
  id: string;
  application_id: string;
  doc_type: ApplicationDocType;
  file_url: string;
  file_name: string;
  size_bytes: number | null;
  mime_type: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_note: string | null;
  created_at: string;
}

export interface VerificationApplication {
  id: string;
  email: string;
  status: string;
  verification_stage: string;
  opening_hours: Record<string, unknown> | null;
}

async function invoke<T = unknown>(action: string, body: unknown): Promise<T> {
  const { data, error } = await db.functions.invoke(`application-verification?action=${action}`, {
    body,
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

async function uploadDoc(applicationId: string, email: string, docType: ApplicationDocType, file: File) {
  const form = new FormData();
  form.append("applicationId", applicationId);
  form.append("email", email);
  form.append("docType", docType);
  form.append("file", file);
  const url = `${import.meta.env.VITE_API_URL}/functions/v1/application-verification?action=upload`;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: import.meta.env.VITE_API_KEY ?? "" },
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export function useApplicationVerification(applicationId: string | null, email: string | null) {
  const [application, setApplication] = useState<VerificationApplication | null>(null);
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!applicationId || !email) return;
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<{ application: VerificationApplication; documents: ApplicationDocument[] }>(
        "list",
        { applicationId, email },
      );
      setApplication(res.application);
      setDocuments(res.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [applicationId, email]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (docType: ApplicationDocType, file: File) => {
      if (!applicationId || !email) throw new Error("Missing application");
      await uploadDoc(applicationId, email, docType, file);
      await refresh();
    },
    [applicationId, email, refresh],
  );

  const remove = useCallback(
    async (docType: ApplicationDocType) => {
      if (!applicationId || !email) throw new Error("Missing application");
      await invoke("delete", { applicationId, email, docType });
      await refresh();
    },
    [applicationId, email, refresh],
  );

  const saveOpeningHours = useCallback(
    async (openingHours: Record<string, unknown>) => {
      if (!applicationId || !email) throw new Error("Missing application");
      await invoke("save-hours", { applicationId, email, openingHours });
      await refresh();
    },
    [applicationId, email, refresh],
  );

  const submit = useCallback(async () => {
    if (!applicationId || !email) throw new Error("Missing application");
    await invoke("submit", { applicationId, email });
    await refresh();
  }, [applicationId, email, refresh]);

  return { application, documents, loading, error, refresh, upload, remove, saveOpeningHours, submit };
}