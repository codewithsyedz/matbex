// =====================================================================
// ZATCA device & clearance health monitor
// ---------------------------------------------------------------------
// Scans recent sales + onboarded devices and emits alerts for:
//   • clearance.failed       - REJECTED or SCHEMA_INVALID invoices
//   • clearance.stale        - PENDING > 10 minutes
//   • device.down            - onboarded device with no successful
//                              clearance in last hour despite attempts
//   • device.csid_expiring   - device CSID expiring in <30 days
// Each event is deduped via public.zatca_alert_state so we only notify
// once per incident. For every new (or escalated) alert we:
//   1. Insert in_app_notifications rows for owners/managers
//   2. Forward to send-audit-alert (email + push) honoring per-user prefs
//   3. Fan out to webhook_configs subscribed to "zatca.*" or specific event
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 min
const DEVICE_DOWN_MS = 60 * 60 * 1000; // 1 hour
const CSID_WARN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESCAN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

type Severity = "info" | "warning" | "critical";

interface Alert {
  tenantId: string;
  alertKey: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  severity: Severity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders, { allowAnyUser: true });
  if (unauthorized) return unauthorized;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = {
    failedInvoices: 0,
    stalePending: 0,
    devicesDown: 0,
    csidExpiring: 0,
    notificationsCreated: 0,
    webhooksDispatched: 0,
    emailsTriggered: 0,
  };

  try {
    const since = new Date(Date.now() - RESCAN_WINDOW_MS).toISOString();
    const alerts: Alert[] = [];

    // sales_transactions has no tenant_id column - resolve tenant via restaurant
    const restaurantTenant = new Map<string, string>();
    {
      const { data: rests } = await supabase.from("restaurants").select("id, tenant_id");
      for (const r of rests ?? []) {
        if (r.id && r.tenant_id) restaurantTenant.set(r.id as string, r.tenant_id as string);
      }
    }
    const tenantOf = (restaurantId: unknown) =>
      restaurantTenant.get(restaurantId as string) ?? "";

    // 1) Failed clearances (REJECTED, SCHEMA_INVALID)
    {
      const { data: failed } = await supabase
        .from("sales_transactions")
        .select(
          "id, restaurant_id, receipt_number, total_amount:total, zatca_device_id, zatca_clearance_status, zatca_clearance_response, created_at",
        )
        .in("zatca_clearance_status", ["REJECTED", "SCHEMA_INVALID"])
        .gte("created_at", since)
        .limit(500);
      summary.failedInvoices = failed?.length ?? 0;
      for (const s of failed ?? []) {
        const status = s.zatca_clearance_status as string;
        const resp = (s.zatca_clearance_response ?? {}) as Record<string, unknown>;
        const errMsg =
          (resp.error as string) ??
          (resp.message as string) ??
          "ZATCA clearance failed";
        alerts.push({
          tenantId: tenantOf(s.restaurant_id),
          alertKey: `clearance.failed:${s.id}`,
          eventType: "zatca.clearance.failed",
          entityType: "sales_transaction",
          entityId: s.id as string,
          severity: "critical",
          title:
            status === "SCHEMA_INVALID"
              ? "Invoice failed ZATCA schema validation"
              : "Invoice rejected by ZATCA",
          message: `Receipt ${s.receipt_number ?? s.id?.toString().slice(0, 6)} (${Number(s.total_amount ?? 0).toFixed(2)}): ${errMsg}`,
          metadata: {
            sales_transaction_id: s.id,
            receipt_number: s.receipt_number,
            status,
            error: errMsg,
            zatca_device_id: s.zatca_device_id,
          },
        });
      }
    }

    // 2) Stale PENDING (> 10 min)
    {
      const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
      const { data: stale } = await supabase
        .from("sales_transactions")
        .select(
          "id, restaurant_id, receipt_number, zatca_device_id, created_at",
        )
        .eq("zatca_clearance_status", "PENDING")
        .lte("created_at", cutoff)
        .gte("created_at", since)
        .limit(500);
      summary.stalePending = stale?.length ?? 0;
      for (const s of stale ?? []) {
        alerts.push({
          tenantId: tenantOf(s.restaurant_id),
          alertKey: `clearance.stale:${s.id}`,
          eventType: "zatca.clearance.stale",
          entityType: "sales_transaction",
          entityId: s.id as string,
          severity: "warning",
          title: "ZATCA clearance pending too long",
          message: `Receipt ${s.receipt_number ?? s.id?.toString().slice(0, 6)} has been pending clearance for over 10 minutes.`,
          metadata: {
            sales_transaction_id: s.id,
            receipt_number: s.receipt_number,
            zatca_device_id: s.zatca_device_id,
            pending_since: s.created_at,
          },
        });
      }
    }

    // 3) Devices: down + CSID expiry
    {
      const { data: devices } = await supabase
        .from("zatca_devices")
        .select(
          "id, tenant_id, name, serial_number, csid_expires_at, registration_status",
        )
        .eq("registration_status", "REGISTERED");

      for (const d of devices ?? []) {
        const tenantId = d.tenant_id as string;

        // CSID expiring soon
        if (d.csid_expires_at) {
          const expires = new Date(d.csid_expires_at as string).getTime();
          const msToExpiry = expires - Date.now();
          if (msToExpiry > 0 && msToExpiry < CSID_WARN_MS) {
            const days = Math.ceil(msToExpiry / (24 * 60 * 60 * 1000));
            summary.csidExpiring++;
            alerts.push({
              tenantId,
              alertKey: `device.csid_expiring:${d.id}`,
              eventType: "zatca.device.csid_expiring",
              entityType: "zatca_device",
              entityId: d.id as string,
              severity: days <= 7 ? "critical" : "warning",
              title: `ZATCA device CSID expires in ${days} day${days === 1 ? "" : "s"}`,
              message: `Device "${d.name}" (${d.serial_number}) needs CSID renewal before ${new Date(expires).toLocaleDateString()}.`,
              metadata: {
                zatca_device_id: d.id,
                device_name: d.name,
                csid_expires_at: d.csid_expires_at,
                days_remaining: days,
              },
            });
          }
        }

        // Device down: had attempts in last 24h but none cleared in last 1h
        const { data: lastCleared } = await supabase
          .from("sales_transactions")
          .select("id, zatca_cleared_at")
          .eq("zatca_device_id", d.id)
          .in("zatca_clearance_status", ["CLEARED", "REPORTED", "CLEARED_SIM"])
          .order("zatca_cleared_at", { ascending: false })
          .limit(1);
        const { count: recentAttempts } = await supabase
          .from("sales_transactions")
          .select("id", { count: "exact", head: true })
          .eq("zatca_device_id", d.id)
          .gte("created_at", since);

        const lastClearTime = lastCleared?.[0]?.zatca_cleared_at
          ? new Date(lastCleared[0].zatca_cleared_at as string).getTime()
          : 0;
        const isDown =
          (recentAttempts ?? 0) > 0 &&
          Date.now() - lastClearTime > DEVICE_DOWN_MS;
        if (isDown) {
          summary.devicesDown++;
          alerts.push({
            tenantId,
            alertKey: `device.down:${d.id}`,
            eventType: "zatca.device.down",
            entityType: "zatca_device",
            entityId: d.id as string,
            severity: "critical",
            title: "ZATCA device appears down",
            message: `No successful clearance from "${d.name}" in over 1 hour, despite recent invoice attempts.`,
            metadata: {
              zatca_device_id: d.id,
              device_name: d.name,
              last_cleared_at: lastCleared?.[0]?.zatca_cleared_at ?? null,
            },
          });
        }
      }
    }

    // 4) Fan out alerts (deduped via zatca_alert_state)
    for (const a of alerts) {
      const { data: existing } = await supabase
        .from("zatca_alert_state")
        .select("id, notification_count, resolved_at")
        .eq("tenant_id", a.tenantId)
        .eq("alert_key", a.alertKey)
        .maybeSingle();

      if (existing && !existing.resolved_at) {
        // Already notified - just bump last_seen_at, don't re-notify.
        await supabase
          .from("zatca_alert_state")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", existing.id);
        continue;
      }

      // Insert / re-open alert state
      const { error: stateErr } = await supabase
        .from("zatca_alert_state")
        .upsert(
          {
            tenant_id: a.tenantId,
            alert_key: a.alertKey,
            entity_type: a.entityType,
            entity_id: a.entityId,
            severity: a.severity,
            message: a.message,
            metadata: a.metadata,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            resolved_at: null,
            notification_count: (existing?.notification_count ?? 0) + 1,
          },
          { onConflict: "tenant_id,alert_key" },
        );
      if (stateErr) {
        console.warn("[zatca-monitor] alert_state upsert failed", stateErr);
        continue;
      }

      // 4a) In-app notifications - owners + managers honoring prefs
      const { data: targets } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", a.tenantId)
        .in("role", ["owner", "manager"]);
      const userIds = (targets ?? []).map((r) => r.user_id as string);
      if (userIds.length > 0) {
        const { data: prefs } = await supabase
          .from("notification_preferences")
          .select("user_id, in_app_enabled, notify_zatca_alerts, email_enabled")
          .eq("tenant_id", a.tenantId)
          .in("user_id", userIds);
        const prefByUser = new Map(
          (prefs ?? []).map((p) => [p.user_id as string, p]),
        );
        const inAppRows = userIds
          .filter((uid) => {
            const p = prefByUser.get(uid);
            // Default opt-in (true) if prefs row missing
            return (
              (p?.in_app_enabled ?? true) && (p?.notify_zatca_alerts ?? true)
            );
          })
          .map((uid) => ({
            tenant_id: a.tenantId,
            user_id: uid,
            action_type: a.eventType.toUpperCase().replace(/\./g, "_"),
            entity_type: a.entityType,
            entity_id: a.entityId,
            title: a.title,
            message: a.message,
            metadata: { ...a.metadata, severity: a.severity },
          }));
        if (inAppRows.length > 0) {
          const { error } = await supabase
            .from("in_app_notifications")
            .insert(inAppRows);
          if (!error) summary.notificationsCreated += inAppRows.length;
        }

        // 4b) Email - for users who opted into email
        const emailUsers = userIds.filter((uid) => {
          const p = prefByUser.get(uid);
          return (
            (p?.email_enabled ?? true) && (p?.notify_zatca_alerts ?? true)
          );
        });
        if (emailUsers.length > 0 && Deno.env.get("RESEND_API_KEY")) {
          // Reuse send-audit-alert plumbing - it already handles per-user
          // resolution + Resend dispatch - by faking an audit_log row.
          for (const uid of emailUsers) {
            try {
              await supabase.functions.invoke("send-audit-alert", {
                body: {
                  audit_log_id: crypto.randomUUID(),
                  action: a.eventType.toUpperCase().replace(/\./g, "_"),
                  entity_type: a.entityType ?? "zatca",
                  entity_id: a.entityId ?? "",
                  user_id: uid,
                  tenant_id: a.tenantId,
                  new_data: { title: a.title, message: a.message, ...a.metadata },
                },
              });
              summary.emailsTriggered++;
            } catch (e) {
              console.warn("[zatca-monitor] email dispatch failed", e);
            }
          }
        }
      }

      // 4c) Webhooks - match by event name or "zatca.*" wildcard
      const { data: hooks } = await supabase
        .from("webhook_configs")
        .select("id, url, events, secret, is_active")
        .eq("is_active", true);
      const matched = (hooks ?? []).filter(
        (h) =>
          (h.events as string[]).includes(a.eventType) ||
          (h.events as string[]).includes("zatca.*"),
      );
      for (const h of matched) {
        const payload = {
          event: a.eventType,
          tenant_id: a.tenantId,
          severity: a.severity,
          title: a.title,
          message: a.message,
          entity: { type: a.entityType, id: a.entityId },
          metadata: a.metadata,
          delivered_at: new Date().toISOString(),
        };
        const body = JSON.stringify(payload);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-matbex-event": a.eventType,
        };
        if (h.secret) {
          headers["x-matbex-signature"] = `sha256=${await hmacSha256Hex(h.secret as string, body)}`;
        }
        let status = 0;
        let respBody = "";
        let ok = false;
        try {
          const res = await fetch(h.url as string, {
            method: "POST",
            headers,
            body,
          });
          status = res.status;
          respBody = (await res.text()).slice(0, 2000);
          ok = res.ok;
        } catch (err) {
          respBody = String(err).slice(0, 2000);
        }
        await supabase.from("webhook_deliveries").insert({
          webhook_config_id: h.id,
          event_type: a.eventType,
          payload,
          response_status: status,
          response_body: respBody,
          success: ok,
        });
        summary.webhooksDispatched++;
      }
    }

    // 5) Auto-resolve: clear stale state rows that no longer match
    const activeKeys = new Set(alerts.map((a) => `${a.tenantId}::${a.alertKey}`));
    const { data: openStates } = await supabase
      .from("zatca_alert_state")
      .select("id, tenant_id, alert_key")
      .is("resolved_at", null);
    for (const s of openStates ?? []) {
      const key = `${s.tenant_id}::${s.alert_key}`;
      if (!activeKeys.has(key)) {
        await supabase
          .from("zatca_alert_state")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", s.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[zatca-monitor] fatal", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message, summary }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      },
    );
  }
});