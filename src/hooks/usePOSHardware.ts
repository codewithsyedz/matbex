import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface POSHardwareSettings {
  id: string;
  restaurant_id: string;
  
  // Receipt Printer
  receipt_printer_enabled: boolean;
  receipt_printer_type: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
  receipt_printer_ip: string | null;
  receipt_printer_port: number;
  receipt_printer_name: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  print_receipt_on_sale: boolean;
  receipt_template: "simple" | "tax_invoice" | "detailed" | "saudi_bilingual" | "zatca_standard";
  default_simplified_template_id: string | null;
  default_standard_template_id: string | null;

  // POS screen layout template (Record Sale UI)
  pos_layout_template: "classic_dense" | "showcase" | "compact_list" | "kiosk_grid" | "poscom_card";
  pos_layout_config: {
    showCategoryStrip?: boolean;
    showChooseItemsTitle?: boolean;
    showCategoryHeaders?: boolean;
    showDescription?: boolean;
    imageShape?: "round" | "rounded" | "square";
    compactTopSpacing?: boolean;
    floatImageTop?: boolean;
  };
  
  // Kitchen Printer
  kitchen_printer_enabled: boolean;
  kitchen_printer_type: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
  kitchen_printer_ip: string | null;
  kitchen_printer_port: number;
  kitchen_printer_name: string | null;
  print_kitchen_on_sale: boolean;

  // Bar Printer (for items with print_route = 'bar')
  bar_printer_enabled: boolean;
  bar_printer_type: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
  bar_printer_ip: string | null;
  bar_printer_port: number;
  bar_printer_name: string | null;
  print_bar_on_sale: boolean;

  // Cash Drawer
  cash_drawer_enabled: boolean;
  cash_drawer_connection: "printer" | "serial" | "none";
  cash_drawer_auto_open_cash: boolean;
  cash_drawer_kick_code: string;

  // Hala POS Card Terminal
  hala_enabled: boolean;
  hala_terminal_id: string | null;
  hala_mock_mode: boolean;
  hala_approve_probability: number;

  // Generic External POS REST integration (card charger provider)
  ext_pos_enabled: boolean;
  ext_pos_provider_name: string | null;
  ext_pos_base_url: string | null;
  ext_pos_charge_path: string | null;
  ext_pos_auth_type: "api_key" | "bearer" | "basic" | "oauth2";
  ext_pos_api_key_header: string | null;
  ext_pos_api_key: string | null;
  ext_pos_bearer_token: string | null;
  ext_pos_basic_username: string | null;
  ext_pos_basic_password: string | null;
  ext_pos_oauth_client_id: string | null;
  ext_pos_oauth_client_secret: string | null;
  ext_pos_oauth_token_url: string | null;
  ext_pos_oauth_scope: string | null;

  created_at: string;
  updated_at: string;
}

export function usePOSHardware() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["pos-hardware-settings", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return null;
      
      const { data, error } = await db
        .from("pos_hardware_settings")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();
      
      if (error) throw error;
      return (data as unknown) as POSHardwareSettings | null;
    },
    enabled: !!restaurant?.id,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<POSHardwareSettings>) => {
      if (!restaurant?.id) throw new Error("No restaurant selected");

      // Check if settings exist
      const { data: existing } = await db
        .from("pos_hardware_settings")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await db
          .from("pos_hardware_settings")
          .update(updates as never)
          .eq("restaurant_id", restaurant.id);
        
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await db
          .from("pos_hardware_settings")
          .insert({
            restaurant_id: restaurant.id,
            ...updates,
          } as never);
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos-hardware-settings", restaurant?.id] });
      toast.success("POS hardware settings saved");
    },
    onError: (error) => {
      console.error("Failed to save POS settings:", error);
      toast.error("Failed to save settings");
    },
  });

  // Get effective settings with defaults
  const effectiveSettings: POSHardwareSettings = settings || {
    id: "",
    restaurant_id: restaurant?.id || "",
    receipt_printer_enabled: false,
    receipt_printer_type: "browser",
    receipt_printer_ip: null,
    receipt_printer_port: 9100,
    receipt_printer_name: null,
    receipt_header: null,
    receipt_footer: null,
    print_receipt_on_sale: true,
    receipt_template: "tax_invoice",
    default_simplified_template_id: null,
    default_standard_template_id: null,
    pos_layout_template: "classic_dense",
    pos_layout_config: {},
    kitchen_printer_enabled: false,
    kitchen_printer_type: "browser",
    kitchen_printer_ip: null,
    kitchen_printer_port: 9100,
    kitchen_printer_name: null,
    print_kitchen_on_sale: true,
    bar_printer_enabled: false,
    bar_printer_type: "browser",
    bar_printer_ip: null,
    bar_printer_port: 9100,
    bar_printer_name: null,
    print_bar_on_sale: true,
    cash_drawer_enabled: false,
    cash_drawer_connection: "printer",
    cash_drawer_auto_open_cash: true,
    cash_drawer_kick_code: "27,112,0,25,250",
    hala_enabled: false,
    hala_terminal_id: null,
    hala_mock_mode: true,
    hala_approve_probability: 0.9,
    ext_pos_enabled: false,
    ext_pos_provider_name: null,
    ext_pos_base_url: null,
    ext_pos_charge_path: null,
    ext_pos_auth_type: "api_key",
    ext_pos_api_key_header: "X-API-Key",
    ext_pos_api_key: null,
    ext_pos_bearer_token: null,
    ext_pos_basic_username: null,
    ext_pos_basic_password: null,
    ext_pos_oauth_client_id: null,
    ext_pos_oauth_client_secret: null,
    ext_pos_oauth_token_url: null,
    ext_pos_oauth_scope: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    settings: effectiveSettings,
    isLoading,
    error,
    updateSettings: updateSettingsMutation.mutate,
    isUpdating: updateSettingsMutation.isPending,
  };
}
