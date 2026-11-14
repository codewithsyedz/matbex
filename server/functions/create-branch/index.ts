import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
// Fixed during migration: `corsHeaders` was referenced but never defined (ReferenceError on every response).
import { corsHeaders } from "../_runtime/cors.ts";
const API_URL = env("API_URL")!;
const ANON_KEY = env("ANON_KEY")!;
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9-]{1,16}$/;

interface CreateBranchBody {
  restaurant_id?: string;
  name?: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  timezone?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- 1. Authenticate caller ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing authorization header" }, 401);
  }
  const token = authHeader.slice("Bearer ".length);

  const userClient = createClient(API_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return json({ error: "Unauthorized - invalid token" }, 401);
  }
  const userId = claimsData.claims.sub as string;

  // --- 2. Parse & validate input ---
  let body: CreateBranchBody;
  try {
    body = (await req.json()) as CreateBranchBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const restaurant_id = (body.restaurant_id ?? "").trim();
  const name = (body.name ?? "").trim();
  const code = body.code?.toString().trim().toUpperCase() || null;
  const address = body.address?.toString().trim() || null;
  const phone = body.phone?.toString().trim() || null;
  const timezone = body.timezone?.toString().trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!restaurant_id || !UUID_RE.test(restaurant_id)) {
    fieldErrors.restaurant_id = "restaurant_id is required and must be a UUID";
  }
  if (!name || name.length < 2 || name.length > 120) {
    fieldErrors.name = "name is required (2–120 chars)";
  }
  if (code && !CODE_RE.test(code)) {
    fieldErrors.code = "code must be 1–16 chars, A–Z 0–9 and dashes only";
  }
  if (phone && phone.length > 40) fieldErrors.phone = "phone too long";
  if (address && address.length > 500) fieldErrors.address = "address too long";
  if (Object.keys(fieldErrors).length) {
    return json({ error: "Validation failed", fieldErrors }, 400);
  }

  // --- 3. Verify the restaurant exists & resolve tenant ---
  const admin = createClient(API_URL, SERVICE_ROLE_KEY);
  const { data: restaurant, error: restErr } = await admin
    .from("restaurants")
    .select("id, tenant_id, name")
    .eq("id", restaurant_id)
    .maybeSingle();

  if (restErr) {
    console.error("create-branch: restaurant lookup failed", restErr);
    return json({ error: "Restaurant lookup failed" }, 500);
  }
  if (!restaurant) {
    return json({ error: "Restaurant not found", fieldErrors: { restaurant_id: "unknown restaurant" } }, 404);
  }

  // --- 4. Authorize: SuperAdmin OR owner/manager of this restaurant ---
  const { data: superFlag } = await admin.rpc("is_superadmin", { _user_id: userId });
  let authorized = superFlag === true;

  if (!authorized) {
    const { data: ownerFlag } = await admin.rpc("has_role", {
      _user_id: userId,
      _restaurant_id: restaurant_id,
      _role: "owner",
    } as any);
    const { data: managerFlag } = await admin.rpc("has_role", {
      _user_id: userId,
      _restaurant_id: restaurant_id,
      _role: "manager",
    } as any);
    authorized = ownerFlag === true || managerFlag === true;
  }

  if (!authorized) {
    return json(
      { error: "Forbidden - requires SuperAdmin or owner/manager of this restaurant" },
      403,
    );
  }

  // --- 5. Compute defaults (is_active / is_primary) ---
  const { data: existing, error: existErr } = await admin
    .from("branches")
    .select("id, is_primary")
    .eq("restaurant_id", restaurant_id)
    .is("deleted_at", null);

  if (existErr) {
    console.error("create-branch: existing-branch query failed", existErr);
    return json({ error: "Failed to inspect existing branches" }, 500);
  }

  const hasAnyBranch = (existing?.length ?? 0) > 0;
  const hasPrimary = existing?.some((b) => b.is_primary) ?? false;

  // First branch is always primary. After that, default to non-primary
  // unless the caller explicitly asks for primary (in which case we
  // demote any previous primary in a transaction-like sequence).
  const is_active = body.is_active === undefined ? true : !!body.is_active;
  let is_primary: boolean;
  if (!hasAnyBranch) {
    is_primary = true;
  } else if (body.is_primary === true) {
    is_primary = true;
  } else {
    is_primary = !hasPrimary && body.is_primary !== false; // backfill if none exists
  }

  // --- 6. If this branch will be primary, clear other primaries first ---
  if (is_primary && hasPrimary) {
    const { error: demoteErr } = await admin
      .from("branches")
      .update({ is_primary: false })
      .eq("restaurant_id", restaurant_id)
      .eq("is_primary", true);
    if (demoteErr) {
      console.error("create-branch: demote previous primary failed", demoteErr);
      return json({ error: "Failed to update existing primary branch" }, 500);
    }
  }

  // --- 7. Insert branch ---
  const { data: inserted, error: insertErr } = await admin
    .from("branches")
    .insert({
      restaurant_id,
      name,
      code,
      address,
      phone,
      timezone,
      is_active,
      is_primary,
    })
    .select("*")
    .single();

  if (insertErr) {
    console.error("create-branch: insert failed", insertErr);
    return json({ error: insertErr.message || "Failed to create branch" }, 500);
  }

  console.log(
    `create-branch OK: user=${userId} tenant=${restaurant.tenant_id} restaurant=${restaurant_id} branch=${inserted.id} primary=${is_primary}`,
  );

  return json({ branch: inserted }, 201);
});