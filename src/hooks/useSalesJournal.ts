import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface SalesJournalRow {
  lineId: string;
  soldAt: string;
  businessDate: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  receiptNumber: string;
  transactionId: string;
  paymentMethod: string;
  menuItemId: string | null;
  itemName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  hasItemDetail: boolean;
}

interface RawRow {
  line_id: string;
  sold_at: string;
  business_date: string;
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  receipt_number: string;
  transaction_id: string;
  payment_method: string;
  menu_item_id: string | null;
  item_name: string;
  category: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  has_item_detail: boolean;
  total_rows: number | string;
}

const num = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

export function useSalesJournal(params: {
  fromDate: string;
  toDate: string;
  branchId: string | null;
  search: string;
  page: number;
  pageSize: number;
}) {
  const { tenant } = useAuth();
  const { fromDate, toDate, branchId, search, page, pageSize } = params;

  const query = useQuery({
    queryKey: ["sales-journal", tenant?.id, fromDate, toDate, branchId, search, page, pageSize],
    enabled: !!tenant?.id && !!fromDate && !!toDate,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_sales_journal", {
        p_tenant_id: tenant!.id,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_branch_id: branchId,
        p_search: search.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const raw = (data ?? []) as unknown as RawRow[];
      return {
        totalRows: raw.length > 0 ? Number(raw[0].total_rows) || 0 : 0,
        rows: raw.map<SalesJournalRow>((row) => ({
          lineId: row.line_id,
          soldAt: row.sold_at,
          businessDate: row.business_date,
          branchId: row.branch_id,
          branchName: row.branch_name,
          currencyCode: row.currency_code,
          receiptNumber: row.receipt_number,
          transactionId: row.transaction_id,
          paymentMethod: row.payment_method,
          menuItemId: row.menu_item_id,
          itemName: row.item_name,
          category: row.category,
          quantity: num(row.quantity),
          unitPrice: num(row.unit_price),
          lineTotal: num(row.line_total),
          hasItemDetail: row.has_item_detail,
        })),
      };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    totalRows: query.data?.totalRows ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
