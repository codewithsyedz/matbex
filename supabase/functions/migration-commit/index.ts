import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MigrationJob {
  id: string;
  restaurant_id: string;
  entity_type: "menu" | "inventory" | "customers" | "staff";
  status: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticated client for permission check
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const jobId = body?.job_id;
    if (!jobId || typeof jobId !== "string") {
      return json({ error: "job_id is required" }, 400);
    }

    // Service client for the actual writes (we already verified via user_client RLS below)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch the job using the USER's RLS to ensure they can access it
    const { data: job, error: jobErr } = await userClient
      .from("migration_jobs")
      .select("id, restaurant_id, entity_type, status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr || !job) return json({ error: "job not found or access denied" }, 403);
    const j = job as MigrationJob;

    if (j.status === "committed") {
      return json({ ok: true, imported: 0, already: true });
    }

    await admin.from("migration_jobs").update({ status: "committing" }).eq("id", j.id);

    // Pull all valid staged records
    const { data: records, error: recErr } = await admin
      .from("migration_records")
      .select("id, normalized")
      .eq("job_id", j.id)
      .eq("status", "valid");
    if (recErr) throw recErr;

    let imported = 0;
    const importedIds: { recordId: string; importedId: string }[] = [];

    if (records && records.length > 0) {
      const rows = records.map(r => ({ recordId: r.id, payload: r.normalized as Record<string, unknown> }));

      const chunkSize = 200;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const inserts = chunk.map(c => buildInsert(j.entity_type, j.restaurant_id, c.payload));
        const { data: inserted, error: insErr } = await admin
          .from(targetTable(j.entity_type))
          .insert(inserts)
          .select("id");
        if (insErr) {
          await admin.from("migration_jobs").update({ status: "failed", summary: { error: insErr.message } }).eq("id", j.id);
          throw insErr;
        }
        (inserted ?? []).forEach((row, idx) => {
          imported++;
          importedIds.push({ recordId: chunk[idx].recordId, importedId: row.id });
        });
      }

      // Mark records as imported (best effort)
      for (const pair of importedIds) {
        await admin
          .from("migration_records")
          .update({ status: "imported", imported_id: pair.importedId })
          .eq("id", pair.recordId);
      }
    }

    await admin
      .from("migration_jobs")
      .update({ status: "committed", imported_count: imported, committed_at: new Date().toISOString() })
      .eq("id", j.id);

    return json({ ok: true, imported });
  } catch (e) {
    console.error("migration-commit error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function targetTable(entity: string): string {
  switch (entity) {
    case "menu": return "menu_items";
    case "inventory": return "inventory_items";
    case "customers": return "customers";
    case "staff": return "staff";
    default: throw new Error(`Unknown entity: ${entity}`);
  }
}

function buildInsert(entity: string, restaurantId: string, p: Record<string, unknown>): Record<string, unknown> {
  const s = (k: string) => (p[k] == null ? null : String(p[k]));
  const n = (k: string, d = 0) => {
    const v = p[k]; if (v == null || v === "") return d;
    const num = Number(v); return Number.isNaN(num) ? d : num;
  };
  switch (entity) {
    case "menu":
      return {
        restaurant_id: restaurantId,
        name: s("name"),
        category: s("category") ?? "main",
        selling_price: n("selling_price"),
        full_price: n("selling_price"),
        description: s("description"),
        vat_category: s("vat_category") ?? "S",
      };
    case "inventory":
      return {
        restaurant_id: restaurantId,
        name: s("name"),
        unit: s("unit") ?? "unit",
        unit_cost: n("unit_cost"),
        current_stock: n("current_stock"),
        reorder_level: p["reorder_level"] == null || p["reorder_level"] === "" ? null : n("reorder_level"),
        category: s("category"),
      };
    case "customers":
      return {
        restaurant_id: restaurantId,
        name: s("name"),
        phone: s("phone"),
        email: s("email"),
        address: s("address"),
        credit_limit: n("credit_limit"),
        current_balance: n("current_balance"),
      };
    case "staff":
      return {
        restaurant_id: restaurantId,
        name: s("name"),
        role: s("role"),
        phone: s("phone"),
        payment_type: s("payment_type") ?? "monthly",
        hourly_rate: n("hourly_rate"),
        monthly_salary: p["monthly_salary"] == null || p["monthly_salary"] === "" ? null : n("monthly_salary"),
      };
    default:
      throw new Error(`Unknown entity: ${entity}`);
  }
}