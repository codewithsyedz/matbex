import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ZatcaSettings {
  id: string;
  tenant_id: string;
  seller_name_en: string | null;
  seller_name_ar: string | null;
  vat_registration_number: string | null;
  qr_enabled: boolean;
  zatca_phase_mode: "PHASE_1" | "PHASE_2_READY";
  qr_size: "SMALL" | "MEDIUM" | "LARGE";
  show_on_printed_receipt: boolean;
  show_on_digital_receipt: boolean;
  auto_generate_pdf_receipt: boolean;
  show_seller_name_on_receipt: boolean;
  show_vat_number_on_receipt: boolean;
  pdf_generation_mode: "STRICT" | "SOFT";
  active_device_id: string | null;
  // Receipt customization (added 2026-05)
  cr_number: string | null;
  branch_address_ar: string | null;
  branch_address_en: string | null;
  google_maps_url: string | null;
  tagline_ar: string | null;
  tagline_en: string | null;
  footer_message_ar: string | null;
  footer_message_en: string | null;
  show_discount_row: boolean;
  show_item_count: boolean;
  show_terminal_id: boolean;
  show_printer_id: boolean;
  show_branch_name: boolean;
  show_logo: boolean;
  // Engagement / contact (added 2026-05)
  phone_display: string | null;
  whatsapp_number: string | null;
  instagram_handle: string | null;
  x_handle: string | null;
  tiktok_handle: string | null;
  snapchat_handle: string | null;
  loyalty_qr_url: string | null;
  loyalty_qr_label_ar: string | null;
  loyalty_qr_label_en: string | null;
  reorder_qr_url: string | null;
  reorder_qr_label_ar: string | null;
  reorder_qr_label_en: string | null;
  promo_message_ar: string | null;
  promo_message_en: string | null;
  show_phone: boolean;
  show_social_handles: boolean;
  show_loyalty_qr: boolean;
  show_reorder_qr: boolean;
  show_promo_message: boolean;
}

export type ZatcaSettingsInput = Omit<
  Partial<ZatcaSettings>,
  "id" | "tenant_id"
>;

const QK = ["zatca-settings"] as const;

export function useZatcaSettings() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...QK, tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ZatcaSettings | null> => {
      const { data, error } = await supabase
        .from("zatca_settings")
        .select("*")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ZatcaSettings | null) ?? null;
    },
  });

  const save = useMutation({
    mutationFn: async (input: ZatcaSettingsInput) => {
      if (!tenantId) throw new Error("No tenant context");
      const payload = { tenant_id: tenantId, ...input };
      const { data, error } = await supabase
        .from("zatca_settings")
        .upsert(payload, { onConflict: "tenant_id" })
        .select()
        .single();
      if (error) throw error;
      return data as ZatcaSettings;
    },
    onSuccess: (data) => {
      qc.setQueryData([...QK, tenantId], data);
    },
  });

  return {
    settings: query.data ?? null,
    loading: query.isLoading,
    saving: save.isPending,
    save: save.mutateAsync,
    refetch: query.refetch,
  };
}