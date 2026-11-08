import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoneyAmount, roundMoney } from "@/lib/vatInclusive";

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

// Fallback list used until the platform_currencies table loads.
// The authoritative list is configured by Super Admins in /admin/currencies.
export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
];

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  source: "live" | "fallback";
  timestamp: string;
}

export function useCurrency() {
  const { restaurant, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  
  const baseCurrency = restaurant?.currency || "SAR";
  const [displayCurrency, setDisplayCurrency] = useState(baseCurrency);

  // Load currencies configured by Super Admin
  const { data: dbCurrencies } = useQuery({
    queryKey: ["platform-currencies", "enabled"],
    queryFn: async (): Promise<CurrencyInfo[]> => {
      const { data, error } = await supabase
        .from("platform_currencies" as any)
        .select("code,name,symbol")
        .eq("enabled", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any) ?? [];
    },
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const supportedCurrencies: CurrencyInfo[] =
    dbCurrencies && dbCurrencies.length > 0 ? dbCurrencies : SUPPORTED_CURRENCIES;

  // Fetch exchange rates
  const { data: exchangeRates, isLoading: ratesLoading } = useQuery({
    queryKey: ["exchange-rates", baseCurrency],
    queryFn: async (): Promise<ExchangeRates> => {
      const { data, error } = await supabase.functions.invoke("get-exchange-rates", {
        body: { baseCurrency },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    refetchOnWindowFocus: false,
  });

  // Update restaurant currency
  const updateCurrencyMutation = useMutation({
    mutationFn: async (newCurrency: string) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { error } = await supabase
        .from("restaurants")
        .update({ currency: newCurrency })
        .eq("id", restaurant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshProfile();
      queryClient.invalidateQueries({ queryKey: ["exchange-rates"] });
    },
  });

  // Convert amount from base currency to display currency
  const convert = useCallback(
    (amount: number, fromCurrency?: string): number => {
      const from = fromCurrency || baseCurrency;
      if (from === displayCurrency || !exchangeRates?.rates) {
        return amount;
      }

      // Convert: amount in 'from' currency to 'displayCurrency'
      const fromRate = exchangeRates.rates[from] || 1;
      const toRate = exchangeRates.rates[displayCurrency] || 1;
      
      // First convert to base, then to target
      const amountInBase = amount / fromRate;
      return amountInBase * toRate;
    },
    [baseCurrency, displayCurrency, exchangeRates]
  );

  // Format amount with currency symbol
  const format = useCallback(
    (amount: number, options?: { showCode?: boolean; fromCurrency?: string }): string => {
      const convertedAmount = convert(amount, options?.fromCurrency);
      const currencyInfo = supportedCurrencies.find((c) => c.code === displayCurrency);
      const symbol = currencyInfo?.symbol || displayCurrency;
      
      // Round with the shared half-up rule first so displayed values match
      // the amounts persisted by POS/ledger math to the cent.
      const formatted = formatMoneyAmount(roundMoney(convertedAmount));

      if (options?.showCode) {
        return `${formatted} ${displayCurrency}`;
      }
      return `${symbol} ${formatted}`;
    },
    [convert, displayCurrency, supportedCurrencies]
  );

  // Sync display currency with base when restaurant changes
  useEffect(() => {
    if (restaurant?.currency) {
      setDisplayCurrency(restaurant.currency);
    }
  }, [restaurant?.currency]);

  const currencyInfo = supportedCurrencies.find((c) => c.code === displayCurrency);

  return {
    baseCurrency,
    displayCurrency,
    setDisplayCurrency,
    currencyInfo,
    exchangeRates,
    ratesLoading,
    convert,
    format,
    updateCurrency: updateCurrencyMutation.mutate,
    isUpdating: updateCurrencyMutation.isPending,
    supportedCurrencies,
  };
}
