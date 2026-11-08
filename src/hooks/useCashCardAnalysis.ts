import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const num = (value: unknown) => Number(value ?? 0) || 0;

export interface CashCardTotals {
  sales: number;
  transactions: number;
  avgTicket: number;
  medianTicket: number;
  days: number;
}

export interface CashCardMethodRow {
  method: string;
  sales: number;
  transactions: number;
  avgTicket: number;
  medianTicket: number;
}

export interface CashCardDailyRow {
  date: string;
  cash: number;
  card: number;
  other: number;
  total: number;
  cashTransactions: number;
  cardTransactions: number;
  transactions: number;
  avgTicket: number;
}

export interface CashCardBandRow {
  band: string;
  cashTransactions: number;
  cardTransactions: number;
  transactions: number;
  sales: number;
}

export interface CashCardHourRow {
  hour: number;
  cash: number;
  card: number;
  total: number;
  transactions: number;
  avgTicket: number;
}

export interface CashCardWeekdayRow {
  dow: number;
  cash: number;
  card: number;
  total: number;
  transactions: number;
  days: number;
  avgTicket: number;
}

export interface CashCardBranchRow {
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  cash: number;
  card: number;
  other: number;
  total: number;
  cashTransactions: number;
  cardTransactions: number;
  transactions: number;
  avgTicket: number;
}

export interface CashCardAnalysis {
  currency: string;
  totals: CashCardTotals;
  methods: CashCardMethodRow[];
  daily: CashCardDailyRow[];
  bands: CashCardBandRow[];
  hours: CashCardHourRow[];
  weekdays: CashCardWeekdayRow[];
  branches: CashCardBranchRow[];
  /** One section per ledger currency (never summed raw). */
  sections?: CashCardAnalysis[];
}

const EMPTY: CashCardAnalysis = {
  currency: "SAR",
  totals: { sales: 0, transactions: 0, avgTicket: 0, medianTicket: 0, days: 0 },
  methods: [],
  daily: [],
  bands: [],
  hours: [],
  weekdays: [],
  branches: [],
};

export function useCashCardAnalysis(fromDate: string, toDate: string, branchId: string | null) {
  const { tenant } = useAuth();

  const query = useQuery({
    queryKey: ["cash-card-analysis", tenant?.id, fromDate, toDate, branchId],
    enabled: !!tenant?.id && !!fromDate && !!toDate,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<CashCardAnalysis> => {
      const { data, error } = await supabase.rpc("get_cash_card_analysis", {
        p_tenant_id: tenant!.id,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_branch_id: branchId,
      });
      if (error) throw error;
      const root = (data ?? {}) as Record<string, any>;
      const rawSections = Array.isArray(root.sections) && root.sections.length > 0 ? root.sections : [root];
      return { ...parseSection(rawSections[0]), sections: rawSections.map(parseSection) };
    },
  });

  return {
    data: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

function parseSection(raw: Record<string, any>): CashCardAnalysis {
      const totals = (raw.totals ?? {}) as Record<string, unknown>;
      return {
        currency: String(raw.currency ?? "SAR"),
        totals: {
          sales: num(totals.sales),
          transactions: num(totals.transactions),
          avgTicket: num(totals.avgTicket),
          medianTicket: num(totals.medianTicket),
          days: num(totals.days),
        },
        methods: ((raw.methods ?? []) as any[]).map((row) => ({
          method: String(row.method ?? "other"),
          sales: num(row.sales),
          transactions: num(row.transactions),
          avgTicket: num(row.avgTicket),
          medianTicket: num(row.medianTicket),
        })),
        daily: ((raw.daily ?? []) as any[]).map((row) => ({
          date: String(row.date),
          cash: num(row.cash),
          card: num(row.card),
          other: num(row.other),
          total: num(row.total),
          cashTransactions: num(row.cashTransactions),
          cardTransactions: num(row.cardTransactions),
          transactions: num(row.transactions),
          avgTicket: num(row.avgTicket),
        })),
        bands: ((raw.bands ?? []) as any[]).map((row) => ({
          band: String(row.band),
          cashTransactions: num(row.cashTransactions),
          cardTransactions: num(row.cardTransactions),
          transactions: num(row.transactions),
          sales: num(row.sales),
        })),
        hours: ((raw.hours ?? []) as any[]).map((row) => ({
          hour: num(row.hour),
          cash: num(row.cash),
          card: num(row.card),
          total: num(row.total),
          transactions: num(row.transactions),
          avgTicket: num(row.avgTicket),
        })),
        weekdays: ((raw.weekdays ?? []) as any[]).map((row) => ({
          dow: num(row.dow),
          cash: num(row.cash),
          card: num(row.card),
          total: num(row.total),
          transactions: num(row.transactions),
          days: num(row.days),
          avgTicket: num(row.avgTicket),
        })),
        branches: ((raw.branches ?? []) as any[]).map((row) => ({
          branchId: row.branchId ?? null,
          branchName: String(row.branchName ?? "Unassigned"),
          currencyCode: String(row.currencyCode ?? raw.currency ?? "SAR"),
          cash: num(row.cash),
          card: num(row.card),
          other: num(row.other),
          total: num(row.total),
          cashTransactions: num(row.cashTransactions),
          cardTransactions: num(row.cardTransactions),
          transactions: num(row.transactions),
          avgTicket: num(row.avgTicket),
        })),
      };
}

type Convert = (value: number, from: string) => number;

/**
 * Combine per-currency report sections into one view in the target currency.
 * Each section's amounts are converted from its own currency before summing,
 * so different currencies are never added together raw. Medians cannot be
 * combined across currencies and become NaN (render as "—").
 */
export function mergeCashCardSections(
  sections: CashCardAnalysis[],
  convert: Convert,
  target: string,
): CashCardAnalysis {
  if (sections.length === 0) return { ...EMPTY, currency: target };
  if (sections.length === 1) return sections[0];

  const byKey = <T,>(rows: T[], key: (r: T) => string | number, map: Map<string | number, T>, add: (a: T, b: T) => T) =>
    rows.forEach((r) => {
      const k = key(r);
      const prev = map.get(k);
      map.set(k, prev ? add(prev, r) : r);
    });
  const avg = (sales: number, n: number) => (n === 0 ? 0 : sales / n);

  const methods = new Map<string | number, CashCardMethodRow>();
  const daily = new Map<string | number, CashCardDailyRow>();
  const bands = new Map<string | number, CashCardBandRow>();
  const hours = new Map<string | number, CashCardHourRow>();
  const weekdays = new Map<string | number, CashCardWeekdayRow>();
  const branches: CashCardBranchRow[] = [];
  const dates = new Set<string>();
  let sales = 0;
  let transactions = 0;

  for (const s of sections) {
    const c = (v: number) => convert(v, s.currency);
    sales += c(s.totals.sales);
    transactions += s.totals.transactions;
    s.daily.forEach((d) => dates.add(d.date));
    byKey(s.methods.map((m) => ({ ...m, sales: c(m.sales), medianTicket: NaN })), (r) => r.method, methods,
      (a, b) => ({ ...a, sales: a.sales + b.sales, transactions: a.transactions + b.transactions }));
    byKey(s.daily.map((d) => ({ ...d, cash: c(d.cash), card: c(d.card), other: c(d.other), total: c(d.total) })), (r) => r.date, daily,
      (a, b) => ({ ...a, cash: a.cash + b.cash, card: a.card + b.card, other: a.other + b.other, total: a.total + b.total,
        cashTransactions: a.cashTransactions + b.cashTransactions, cardTransactions: a.cardTransactions + b.cardTransactions,
        transactions: a.transactions + b.transactions }));
    byKey(s.bands.map((b) => ({ ...b, sales: c(b.sales) })), (r) => r.band, bands,
      (a, b) => ({ ...a, sales: a.sales + b.sales, transactions: a.transactions + b.transactions,
        cashTransactions: a.cashTransactions + b.cashTransactions, cardTransactions: a.cardTransactions + b.cardTransactions }));
    byKey(s.hours.map((h) => ({ ...h, cash: c(h.cash), card: c(h.card), total: c(h.total) })), (r) => r.hour, hours,
      (a, b) => ({ ...a, cash: a.cash + b.cash, card: a.card + b.card, total: a.total + b.total, transactions: a.transactions + b.transactions }));
    byKey(s.weekdays.map((w) => ({ ...w, cash: c(w.cash), card: c(w.card), total: c(w.total) })), (r) => r.dow, weekdays,
      (a, b) => ({ ...a, cash: a.cash + b.cash, card: a.card + b.card, total: a.total + b.total,
        transactions: a.transactions + b.transactions, days: Math.max(a.days, b.days) }));
    s.branches.forEach((b) => branches.push({ ...b, cash: c(b.cash), card: c(b.card), other: c(b.other), total: c(b.total), avgTicket: c(b.avgTicket) }));
  }

  const withAvg = <T extends { transactions: number }>(rows: T[], total: (r: T) => number) =>
    rows.map((r) => ({ ...r, avgTicket: avg(total(r), r.transactions) }));

  return {
    currency: target,
    totals: { sales, transactions, avgTicket: avg(sales, transactions), medianTicket: NaN, days: dates.size },
    methods: withAvg([...methods.values()], (r) => r.sales).sort((a, b) => b.sales - a.sales),
    daily: withAvg([...daily.values()], (r) => r.total).sort((a, b) => a.date.localeCompare(b.date)),
    bands: [...bands.values()],
    hours: withAvg([...hours.values()], (r) => r.total).sort((a, b) => a.hour - b.hour),
    weekdays: withAvg([...weekdays.values()], (r) => r.total).sort((a, b) => a.dow - b.dow),
    branches: branches.sort((a, b) => b.total - a.total),
  };
}
