import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 30 demo menu items spanning categories
const DEMO_MENU: Array<{ name: string; category: string; price: number }> = [
  { name: "Chicken Shawarma Plate", category: "main", price: 32 },
  { name: "Beef Shawarma Wrap", category: "main", price: 24 },
  { name: "Mixed Grill Platter", category: "main", price: 78 },
  { name: "Lamb Kabsa", category: "main", price: 58 },
  { name: "Chicken Mandi", category: "main", price: 48 },
  { name: "Falafel Wrap", category: "main", price: 18 },
  { name: "Shish Tawook", category: "main", price: 42 },
  { name: "Beef Kofta", category: "main", price: 38 },
  { name: "Grilled Hammour", category: "main", price: 65 },
  { name: "Margherita Pizza", category: "main", price: 45 },
  { name: "Pepperoni Pizza", category: "main", price: 52 },
  { name: "Caesar Salad", category: "starter", price: 28 },
  { name: "Fattoush Salad", category: "starter", price: 22 },
  { name: "Tabbouleh", category: "starter", price: 18 },
  { name: "Hummus with Pita", category: "starter", price: 16 },
  { name: "Mutabbal", category: "starter", price: 18 },
  { name: "Cheese Sambousek", category: "starter", price: 14 },
  { name: "Lentil Soup", category: "starter", price: 16 },
  { name: "French Fries", category: "side", price: 12 },
  { name: "Garlic Bread", category: "side", price: 10 },
  { name: "Rice Pilaf", category: "side", price: 10 },
  { name: "Arabic Coffee", category: "beverage", price: 8 },
  { name: "Karak Tea", category: "beverage", price: 6 },
  { name: "Fresh Orange Juice", category: "beverage", price: 14 },
  { name: "Mint Lemonade", category: "beverage", price: 16 },
  { name: "Sparkling Water", category: "beverage", price: 8 },
  { name: "Pepsi", category: "beverage", price: 8 },
  { name: "Kunafa", category: "dessert", price: 24 },
  { name: "Umm Ali", category: "dessert", price: 22 },
  { name: "Baklava (3pc)", category: "dessert", price: 18 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // If user already belongs to a tenant, return that one (idempotent).
    const { data: existingRoles } = await admin
      .from("user_tenant_roles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1);

    if (existingRoles && existingRoles.length > 0) {
      return new Response(
        JSON.stringify({ ok: true, tenant_id: existingRoles[0].tenant_id, already_exists: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fullName = (user.user_metadata?.full_name as string) || user.email || "Demo Owner";
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const tenantName = `${fullName.split(" ")[0] || "Demo"} Demo ${Date.now().toString(36).slice(-4).toUpperCase()}`;

    // Resolve a sensible default plan id (pro) if it exists, else any plan
    const { data: planRow } = await admin
      .from("plans").select("id").eq("name", "pro").maybeSingle();
    const planId = planRow?.id ?? null;

    // 1) Create tenant
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .insert({
        name: tenantName,
        status: "trial",
        tenant_type: "DEMO_ENTERPRISE",
        allow_real_payments: false,
        allow_exports: false,
        max_branches: 2,
        trial_ends_at: trialEndsAt,
        plan_id: planId,
        settings: { demo: true, seeded_at: new Date().toISOString() },
      })
      .select()
      .single();
    if (tErr) throw tErr;

    // 2) Create restaurant (branch)
    const { data: restaurant, error: rErr } = await admin
      .from("restaurants")
      .insert({
        tenant_id: tenant.id,
        name: "Matbex Central Kitchen",
        currency: "SAR",
        timezone: "Asia/Riyadh",
        status: "active",
        plan: "enterprise",
        is_primary: true,
      })
      .select()
      .single();
    if (rErr) throw rErr;

    // 3) Owner role + profile attachment
    await admin.from("user_tenant_roles").insert({
      user_id: user.id,
      tenant_id: tenant.id,
      role: "owner",
    });

    await admin.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      tenant_id: tenant.id,
      restaurant_id: restaurant.id,
    });

    // 4) Seed 30 demo menu items (VAT 15% via 'S' standard rate)
    const menuRows = DEMO_MENU.map((m) => ({
      restaurant_id: restaurant.id,
      name: m.name,
      category: m.category,
      selling_price: m.price,
      full_price: m.price,
      half_price: 0,
      quarter_price: 0,
      is_active: true,
      vat_category: "S",
    }));
    const { error: mErr } = await admin.from("menu_items").insert(menuRows);
    if (mErr) console.warn("menu seed error", mErr);

    return new Response(
      JSON.stringify({
        ok: true,
        tenant_id: tenant.id,
        restaurant_id: restaurant.id,
        trial_ends_at: trialEndsAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[provision-demo-tenant]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});