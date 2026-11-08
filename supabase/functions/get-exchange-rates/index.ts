import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
// Fallback rates if API fails (rates relative to SAR)
const FALLBACK_RATES: Record<string, number> = {
  SAR: 1,
  USD: 0.2666,
  EUR: 0.2444,
  GBP: 0.2111,
  AED: 0.9793,
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { baseCurrency = "SAR" } = await req.json();
    
    console.log(`Fetching exchange rates for base currency: ${baseCurrency}`);

    // Try to fetch from a free exchange rate API
    try {
      const response = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${baseCurrency}`
      );
      
      if (response.ok) {
        const data = await response.json();
        console.log("Successfully fetched live rates");
        
        // Return relevant currencies
        const rates: Record<string, number> = {
          SAR: data.rates.SAR || 1,
          USD: data.rates.USD,
          EUR: data.rates.EUR,
          GBP: data.rates.GBP,
          AED: data.rates.AED,
        };

        return new Response(
          JSON.stringify({
            base: baseCurrency,
            rates,
            source: "live",
            timestamp: new Date().toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (apiError) {
      console.warn("API fetch failed, using fallback rates:", apiError);
    }

    // Use fallback rates if API fails
    // Calculate rates relative to the requested base currency
    const baseToSar = baseCurrency === "SAR" ? 1 : (1 / FALLBACK_RATES[baseCurrency]);
    const rates: Record<string, number> = {};
    
    for (const [currency, sarRate] of Object.entries(FALLBACK_RATES)) {
      rates[currency] = sarRate * baseToSar;
    }

    return new Response(
      JSON.stringify({
        base: baseCurrency,
        rates,
        source: "fallback",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-exchange-rates:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
