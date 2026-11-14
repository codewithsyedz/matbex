import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  generateCertificationReportBlob,
  type CertificationReportInput,
} from "@/lib/zatca/certificationReportPdf";

const BUCKET = "zatca-certification-reports";

export interface ZatcaCertificationReport {
  id: string;
  tenant_id: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number | null;
  completed_steps: number;
  total_steps: number;
  certified: boolean;
  generated_by: string | null;
  notes: string | null;
  created_at: string;
  verification_token: string;
}

const QK = ["zatca-certification-reports"] as const;

export function useZatcaCertificationReports() {
  const { user, tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [...QK, tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ZatcaCertificationReport[]> => {
      const { data, error } = await db
        .from("zatca_certification_reports")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ZatcaCertificationReport[];
    },
  });

  const save = useMutation({
    mutationFn: async (input: CertificationReportInput) => {
      if (!tenantId || !user?.id) throw new Error("Not authenticated");
      // Pre-allocate a verification token so the PDF can embed its own QR link.
      const verificationToken = crypto.randomUUID();
      const verificationUrl = `${window.location.origin}/verify/zatca/${verificationToken}`;

      const snapshot = {
        tenantName: input.tenantName,
        generatedAt: new Date().toISOString(),
        seller: {
          name_en: input.settings?.seller_name_en ?? null,
          name_ar: input.settings?.seller_name_ar ?? null,
          vat_registration_number: input.settings?.vat_registration_number ?? null,
          zatca_phase_mode: input.settings?.zatca_phase_mode ?? null,
          pdf_generation_mode: input.settings?.pdf_generation_mode ?? null,
        },
        steps: input.steps,
        devices: input.devices.map((d) => {
          const x = d as unknown as {
            compliance_csid: string | null;
            production_csid: string | null;
            compliance_passed_at: string | null;
          };
          return {
            name: d.name,
            serial_number: d.serial_number,
            registration_status: d.registration_status,
            icv_counter: d.icv_counter,
            compliance_csid_issued: !!x.compliance_csid,
            production_csid_issued: !!x.production_csid,
            compliance_passed_at: x.compliance_passed_at,
            csid_expires_at: d.csid_expires_at,
          };
        }),
        metrics: input.metrics,
      };

      const { blob, fileName } = await generateCertificationReportBlob({
        ...input,
        verificationUrl,
      });
      const path = `${tenantId}/${fileName}`;
      const { error: upErr } = await db.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;

      const completed = input.steps.filter((s) => s.state === "done").length;
      const { error: insErr } = await db
        .from("zatca_certification_reports")
        .insert({
          tenant_id: tenantId,
          storage_path: path,
          file_name: fileName,
          file_size_bytes: blob.size,
          completed_steps: completed,
          total_steps: input.steps.length,
          certified: completed === input.steps.length && input.steps.length > 0,
          generated_by: user.id,
          verification_token: verificationToken,
          snapshot: JSON.parse(JSON.stringify(snapshot)),
        } as never);
      if (insErr) {
        await db.storage.from(BUCKET).remove([path]);
        throw insErr;
      }
      return { blob, fileName, verificationUrl };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  const download = useMutation({
    mutationFn: async (report: ZatcaCertificationReport) => {
      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(report.storage_path, 60);
      if (error || !data) throw error ?? new Error("Could not sign URL");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
  });

  const remove = useMutation({
    mutationFn: async (report: ZatcaCertificationReport) => {
      const { error: delErr } = await db
        .from("zatca_certification_reports")
        .delete()
        .eq("id", report.id);
      if (delErr) throw delErr;
      await db.storage.from(BUCKET).remove([report.storage_path]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  return { list, save, download, remove };
}