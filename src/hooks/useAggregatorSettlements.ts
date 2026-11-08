import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type SettlementChannel = "hungerstation" | "jahez" | "mrsool" | "talabat";
export type SettlementStatus = "pending" | "reconciled" | "disputed";

export interface AggregatorSettlement {
  id: string;
  tenant_id: string;
  channel: SettlementChannel;
  settlement_date: string;
  gross_amount: number;
  commission_amount: number;
  net_payout: number;
  reference: string | null;
  status: SettlementStatus;
  notes: string | null;
  bank_account_code: string;
  reconciled_at: string | null;
  created_at: string;
}

export interface NewSettlement {
  channel: SettlementChannel;
  settlement_date: string;
  gross_amount: number;
  commission_amount: number;
  net_payout: number;
  reference?: string;
  notes?: string;
  bank_account_code?: string;
}

export function useAggregatorSettlements() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id;

  const list = useQuery({
    queryKey: ["aggregator-settlements", tenantId],
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aggregator_settlements")
        .select("*")
        .is("deleted_at", null)
        .order("settlement_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AggregatorSettlement[];
    },
  });

  const create = useMutation({
    mutationFn: async (input: NewSettlement) => {
      if (!tenantId) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("aggregator_settlements")
        .insert({
          tenant_id: tenantId,
          channel: input.channel,
          settlement_date: input.settlement_date,
          gross_amount: input.gross_amount,
          commission_amount: input.commission_amount,
          net_payout: input.net_payout,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          bank_account_code: input.bank_account_code ?? "1100",
        })
        .select()
        .single();
      if (error) throw error;
      return data as AggregatorSettlement;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aggregator-settlements", tenantId] });
      toast.success("Settlement recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reconcile = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("aggregator_settlements")
        .update({ status: "reconciled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aggregator-settlements", tenantId] });
      qc.invalidateQueries({ queryKey: ["channel-pnl", tenantId] });
      toast.success("Settlement reconciled — ledger posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("aggregator_settlements")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aggregator-settlements", tenantId] });
      toast.success("Settlement removed");
    },
  });

  return { list, create, reconcile, softDelete };
}