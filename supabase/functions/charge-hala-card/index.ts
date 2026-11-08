import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
// Hala POS card-charge edge function (SCAFFOLD / MOCK)
//
// This function will eventually call the real Hala Cloud API to push a charge
// amount to a physical Hala terminal and wait for the cardholder approval.
//
// For now (no API credentials yet), it runs in MOCK MODE: it simulates a
// network round-trip and returns either an "approved" or "declined" result
// based on the configured probability. The contract is final, so swapping
// the mock for a real call later is a one-file change.

interface ChargeRequest {
  amount: number;
  currency?: string;
  terminalId?: string;
  receiptNumber?: string;
  mock?: boolean;
  approveProbability?: number; // 0..1, only used in mock mode
}

function makeRrn() {
  // 12-digit reference (mimics RRN). Real Hala will return its own.
  const n = Math.floor(Math.random() * 1_000_000_000_000)
    .toString()
    .padStart(12, "0");
  return n;
}

function makeAuthCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function runMockCharge(req: ChargeRequest) {
  // Simulate cardholder tapping/inserting card on the terminal
  const delay = 1500 + Math.random() * 1500;
  await new Promise((r) => setTimeout(r, delay));

  const p = typeof req.approveProbability === "number"
    ? Math.max(0, Math.min(1, req.approveProbability))
    : 0.9;

  const approved = Math.random() < p;

  if (approved) {
    return {
      status: "approved" as const,
      reference: makeRrn(),
      authCode: makeAuthCode(),
      cardScheme: ["Visa", "Mastercard", "Mada"][Math.floor(Math.random() * 3)],
      maskedPan: `**** **** **** ${Math.floor(1000 + Math.random() * 9000)}`,
      message: "Approved (mock)",
      mock: true,
    };
  }

  return {
    status: "declined" as const,
    reference: null,
    authCode: null,
    message: "Declined by issuer (mock)",
    mock: true,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authn: payment-adjacent endpoint - require a valid session.
    try {
      await requireUser(req);
    } catch (resp) {
      if (resp instanceof Response) {
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw resp;
    }

    const body = (await req.json()) as ChargeRequest;

    if (!body || typeof body.amount !== "number" || body.amount <= 0) {
      return new Response(
        JSON.stringify({ error: "amount must be a positive number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const useMock = body.mock !== false; // default to mock until real creds are wired

    if (useMock) {
      const result = await runMockCharge(body);
      return new Response(
        JSON.stringify({
          ...result,
          amount: body.amount,
          currency: body.currency ?? "SAR",
          terminalId: body.terminalId ?? null,
          receiptNumber: body.receiptNumber ?? null,
          chargedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- REAL HALA INTEGRATION GOES HERE ----
    // const HALA_API_KEY = Deno.env.get("HALA_API_KEY");
    // const HALA_MERCHANT_ID = Deno.env.get("HALA_MERCHANT_ID");
    // if (!HALA_API_KEY || !HALA_MERCHANT_ID) {
    //   return new Response(JSON.stringify({ error: "Hala credentials not configured" }), {
    //     status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    //   });
    // }
    // const upstream = await fetch("https://api.hala.example/v1/charges", {
    //   method: "POST",
    //   headers: {
    //     "Authorization": `Bearer ${HALA_API_KEY}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     merchantId: HALA_MERCHANT_ID,
    //     terminalId: body.terminalId,
    //     amount: body.amount,
    //     currency: body.currency ?? "SAR",
    //     reference: body.receiptNumber,
    //   }),
    // });
    // const data = await upstream.json();
    // return new Response(JSON.stringify(data), {
    //   status: upstream.status,
    //   headers: { ...corsHeaders, "Content-Type": "application/json" },
    // });

    return new Response(
      JSON.stringify({
        error: "Live Hala integration not configured. Enable mock mode in POS settings.",
      }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ status: "error", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});