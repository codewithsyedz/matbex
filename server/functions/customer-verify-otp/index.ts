import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";
import { normalizePhone, sha256Hex, signCustomerJwt } from "../_shared/customerJwt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { phone, code, name } = await req.json().catch(() => ({}));
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) return json({ error: "Invalid phone" }, 400);
    if (!/^\d{6}$/.test(String(code ?? ""))) return json({ error: "Invalid code" }, 400);

    const admin = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    const { data: otp, error: fetchErr } = await admin
      .from("customer_otps")
      .select("id, code_hash, expires_at, attempts, consumed_at")
      .eq("phone", normalized)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!otp) return json({ error: "No active code. Please request a new one." }, 400);
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      return json({ error: "Code expired. Request a new one." }, 400);
    }
    if (otp.attempts >= 5) return json({ error: "Too many attempts. Request a new code." }, 429);

    const expected = await sha256Hex(`${normalized}:${code}`);
    if (expected !== otp.code_hash) {
      await admin.from("customer_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
      return json({ error: "Incorrect code" }, 400);
    }

    // Consume + upsert customer profile
    await admin.from("customer_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

    const { data: existing } = await admin
      .from("customer_profiles")
      .select("id, name, blocked")
      .eq("phone", normalized)
      .maybeSingle();

    if (existing?.blocked) return json({ error: "Account is blocked. Contact support." }, 403);

    let customerId = existing?.id as string | undefined;
    if (!customerId) {
      const { data: inserted, error: insErr } = await admin
        .from("customer_profiles")
        .insert({ phone: normalized, name: name?.toString().slice(0, 80) ?? null, last_seen_at: new Date().toISOString() })
        .select("id")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      customerId = inserted.id;
    } else {
      await admin
        .from("customer_profiles")
        .update({
          last_seen_at: new Date().toISOString(),
          ...(name && !existing.name ? { name: String(name).slice(0, 80) } : {}),
        })
        .eq("id", customerId);
    }

    const token = await signCustomerJwt({ sub: customerId!, phone: normalized });
    return json({ token, customer: { id: customerId, phone: normalized } });
  } catch (e: any) {
    console.error("customer-verify-otp error", e);
    return json({ error: e?.message ?? "Verification failed" }, 500);
  }
});