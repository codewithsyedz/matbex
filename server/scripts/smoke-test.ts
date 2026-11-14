/**
 * End-to-end smoke test against a running stack (API + PostgREST + Postgres).
 *
 *   API_URL=http://localhost:8000 SERVICE_ROLE_KEY=... npx tsx scripts/smoke-test.ts
 *
 * Creates a throwaway user + tenant, exercises auth, data, rpc, MFA, storage,
 * functions and realtime through @matbex/client, then cleans up.
 */
import * as OTPAuth from "otpauth";
import { createClient } from "@matbex/client";

const API = process.env.API_URL ?? "http://localhost:8000";
const SERVICE = process.env.SERVICE_ROLE_KEY!;
const results: { name: string; ok: boolean; info?: string }[] = [];
const check = async (name: string, fn: () => Promise<string | void>) => {
  try {
    const info = await fn();
    results.push({ name, ok: true, info: info ?? "" });
  } catch (e: any) {
    results.push({ name, ok: false, info: e?.message ?? String(e) });
  }
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const admin = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const user = createClient(API, undefined, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
const email = `smoke+${Date.now()}@example.test`;
const password = "Sm0ke-test-password!";
let uid = "";
let tenantId = "";

await check("health", async () => {
  const r = await fetch(`${API}/health`);
  assert(r.ok, `status ${r.status}`);
});

await check("auth.signUp (autoconfirm)", async () => {
  const { data, error } = await user.auth.signUp({ email, password, options: { data: { full_name: "Smoke Test" } } });
  if (error) throw error;
  assert(data.session?.access_token, "no session returned");
  uid = data.user!.id;
  return uid;
});

await check("auth.signOut + signInWithPassword", async () => {
  await user.auth.signOut();
  const { data, error } = await user.auth.signInWithPassword({ email, password });
  if (error) throw error;
  assert(data.session, "no session");
});

await check("auth.signInWithPassword rejects bad password", async () => {
  const other = createClient(API, undefined, { auth: { persistSession: false } });
  const { error } = await other.auth.signInWithPassword({ email, password: "wrong-password" });
  assert(error && error.status === 400, "expected 400");
});

await check("auth.getUser", async () => {
  const { data, error } = await user.auth.getUser();
  if (error) throw error;
  assert(data.user?.email === email, "email mismatch");
  assert(data.user?.user_metadata.full_name === "Smoke Test", "metadata missing");
});

await check("auth.refreshSession rotates tokens", async () => {
  const before = (await user.auth.getSession()).data.session!;
  const { data, error } = await user.auth.refreshSession();
  if (error) throw error;
  assert(data.session!.refresh_token !== before.refresh_token, "refresh token not rotated");
});

await check("admin.createUser / getUserById (service role)", async () => {
  const { data, error } = await admin.auth.admin.createUser({ email: `smoke-admin+${Date.now()}@example.test`, password, email_confirm: true });
  if (error) throw error;
  const got = await admin.auth.admin.getUserById(data.user!.id);
  assert(got.data.user?.id === data.user!.id, "lookup failed");
  await admin.auth.admin.deleteUser(data.user!.id);
});

await check("admin API rejects user tokens", async () => {
  const token = (await user.auth.getSession()).data.session!.access_token;
  const r = await fetch(`${API}/auth/v1/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

await check("data: service role insert tenant", async () => {
  const { data, error } = await admin.from("tenants").insert({ name: "Smoke Tenant", slug: `smoke-${Date.now()}` }).select("id").single();
  if (error) throw error;
  tenantId = data.id;
  return tenantId;
});

await check("data: RLS hides other tenants from user", async () => {
  const { data, error } = await user.from("tenants").select("id").eq("id", tenantId);
  if (error) throw error;
  assert(Array.isArray(data) && data.length === 0, `user can see tenant (${JSON.stringify(data)})`);
});

await check("data: count + head", async () => {
  const { count, error } = await admin.from("tenants").select("*", { count: "exact", head: true });
  if (error) throw error;
  assert(typeof count === "number" && count >= 1, `count=${count}`);
  return `count=${count}`;
});

await check("data: maybeSingle returns null for no rows", async () => {
  const { data, error } = await user.from("tenants").select("id").eq("id", "00000000-0000-0000-0000-000000000000").maybeSingle();
  if (error) throw error;
  assert(data === null, "expected null");
});

await check("rpc: is_superadmin(self) = false", async () => {
  const { data, error } = await user.rpc("is_superadmin", { _user_id: uid });
  if (error) throw error;
  assert(data === false, `got ${JSON.stringify(data)}`);
});

await check("rpc: secret function blocked for anon", async () => {
  const anon = createClient(API, undefined, { auth: { persistSession: false } });
  const { error } = await anon.rpc("current_cron_token");
  assert(error?.code === "42501", `expected 42501, got ${JSON.stringify(error)}`);
});

await check("storage: upload to own avatar folder", async () => {
  const { data, error } = await user.storage.from("avatars").upload(`${uid}/smoke.txt`, new Blob(["hello matbex"], { type: "text/plain" }), { upsert: true });
  if (error) throw error;
  assert(data?.path, "no path");
});

await check("storage: RLS blocks upload into someone else's folder", async () => {
  const { error } = await user.storage.from("avatars").upload(`00000000-0000-0000-0000-000000000000/x.txt`, new Blob(["x"], { type: "text/plain" }));
  assert(error, "upload should be rejected");
});

await check("storage: public URL serves bytes", async () => {
  const { data } = user.storage.from("avatars").getPublicUrl(`${uid}/smoke.txt`);
  const r = await fetch(data.publicUrl);
  assert(r.ok && (await r.text()) === "hello matbex", `status ${r.status}`);
});

await check("storage: signed URL + download + list + remove", async () => {
  const s = await user.storage.from("avatars").createSignedUrl(`${uid}/smoke.txt`, 60);
  if (s.error) throw s.error;
  assert((await (await fetch(s.data!.signedUrl)).text()) === "hello matbex", "signed url content");
  const d = await user.storage.from("avatars").download(`${uid}/smoke.txt`);
  if (d.error) throw d.error;
  const l = await user.storage.from("avatars").list(uid);
  assert(l.data?.some((f) => f.name === "smoke.txt"), "list missing file");
  const rm = await user.storage.from("avatars").remove([`${uid}/smoke.txt`]);
  assert(rm.data?.length === 1, "remove failed");
});

await check("functions: resolve-tenant-code (public function)", async () => {
  const { data: t } = await admin.from("tenants").select("slug").eq("id", tenantId).single();
  const { data, error } = await user.functions.invoke("resolve-tenant-code", { body: { code: t.slug } });
  if (error) throw error;
  assert(data?.ok && data.tenant.id === tenantId, JSON.stringify(data));
});

await check("functions: non-2xx surfaces FunctionsHttpError with context", async () => {
  const { error } = await user.functions.invoke("resolve-tenant-code", { body: { code: "does-not-exist" } });
  assert(error?.name === "FunctionsHttpError", "expected FunctionsHttpError");
  const body = await error.context.json();
  assert(body.error === "Tenant code not found", JSON.stringify(body));
});

// /api/v1 modules: route, auth, validation and role check. Writes nothing, so it is safe to
// run against production (a successful sale is covered by the local integration test).
await check("api/v1: pos sales validates input and refuses users without a role", async () => {
  const { data: s } = await user.auth.getSession();
  const post = (body: unknown, auth = true) =>
    fetch(`${API}/api/v1/pos/sales`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${s.session!.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
  const { data: r } = await admin.from("restaurants").insert({ name: "Smoke Restaurant", tenant_id: tenantId }).select("id").single();
  const sale = { restaurantId: r!.id, paymentMethod: "cash", lines: [{ menuItemId: crypto.randomUUID(), quantity: 1, unitPrice: 1 }] };
  assert((await post(sale, false)).status === 401, "no token should be 401");
  assert((await post({ ...sale, lines: [] })).status === 400, "empty lines should be 400");
  const forbidden = await post(sale);
  assert(forbidden.status === 403, `user without a role should be 403, got ${forbidden.status}`);
  await admin.from("restaurants").delete().eq("id", r!.id);
});

// cache-proxy builds a client with the caller's token in global headers and calls
// auth.getUser(): guards the bug where the anon key overrode that header (403).
await check("functions: act-as-user client + Redis cache round trip", async () => {
  const key = `smoke-${uid}`;
  const set = await user.functions.invoke("cache-proxy", { body: { op: "set", key, value: { ok: 1 }, ttl: 10 } });
  assert(!set.error, `set failed: ${set.error?.message}`);
  const got = await user.functions.invoke("cache-proxy", { body: { op: "get", key } });
  assert(!got.error, `get failed: ${got.error?.message}`);
  await user.functions.invoke("cache-proxy", { body: { op: "del", key } });
  return (got.data as any)?.hit ? "redis hit" : "no Redis configured (miss)";
});

await check("realtime: RLS-filtered postgres_changes", async () => {
  const got: any[] = [];
  const ch = user
    .channel(`smoke-${uid}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "in_app_notifications", filter: `user_id=eq.${uid}` }, (p) => got.push(p));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("subscribe timeout")), 5000);
    ch.subscribe((s) => s === "SUBSCRIBED" && (clearTimeout(t), resolve()));
  });
  const ins = await admin.from("in_app_notifications").insert({ user_id: uid, tenant_id: tenantId, title: "Hi", message: "Smoke", action_type: "info" });
  if (ins.error) throw ins.error;
  await new Promise((r) => setTimeout(r, 1500));
  await user.removeChannel(ch);
  assert(got.length === 1 && got[0].new.title === "Hi", `events=${got.length}`);
});

await check("realtime: other users never receive rows RLS hides from them", async () => {
  const intruder = createClient(API, undefined, { auth: { persistSession: false, autoRefreshToken: false } });
  const reg = await intruder.auth.signUp({ email: `smoke-intruder+${Date.now()}@example.test`, password });
  if (reg.error) throw reg.error;
  const got: any[] = [];
  const ch = intruder.channel("intruder").on("postgres_changes", { event: "*", schema: "public", table: "in_app_notifications" }, (p) => got.push(p));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("subscribe timeout")), 5000);
    ch.subscribe((s) => s === "SUBSCRIBED" && (clearTimeout(t), resolve()));
  });
  const ins = await admin.from("in_app_notifications").insert({ user_id: uid, tenant_id: tenantId, title: "Private", message: "x", action_type: "info" });
  if (ins.error) throw ins.error;
  await new Promise((r) => setTimeout(r, 1500));
  await intruder.removeChannel(ch);
  await admin.auth.admin.deleteUser(reg.data.user!.id);
  assert(got.length === 0, `intruder received ${got.length} event(s)`);
});

await check("mfa: enroll + challenge + verify → aal2", async () => {
  const en = await user.auth.mfa.enroll({ factorType: "totp", friendlyName: "smoke" });
  if (en.error) throw en.error;
  assert(en.data.totp.qr_code.startsWith("data:image/svg+xml"), "qr code");
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(en.data.totp.secret) }).generate();
  const ch = await user.auth.mfa.challenge({ factorId: en.data.id });
  if (ch.error) throw ch.error;
  const v = await user.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code });
  if (v.error) throw v.error;
  const aal = await user.auth.mfa.getAuthenticatorAssuranceLevel();
  assert(aal.data?.currentLevel === "aal2", `aal=${aal.data?.currentLevel}`);
  const un = await user.auth.mfa.unenroll({ factorId: en.data.id });
  if (un.error) throw un.error;
});

await check("mcp: tools/list with user token", async () => {
  const token = (await user.auth.getSession()).data.session!.access_token;
  const r = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await r.text();
  assert(r.ok && text.includes("sales_summary"), `status ${r.status}: ${text.slice(0, 200)}`);
});

await check("auth.signOut invalidates session", async () => {
  const token = (await user.auth.getSession()).data.session!.access_token;
  await user.auth.signOut();
  const r = await fetch(`${API}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}` } });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

// cleanup
// Restaurants first: a check that failed half-way can leave its restaurant behind, and the
// tenant cannot be deleted while one references it (the next run would then fail on the
// unique tenant name).
if (tenantId) {
  await admin.from("restaurants").delete().eq("tenant_id", tenantId);
  await admin.from("tenants").delete().eq("id", tenantId);
}
if (uid) await admin.auth.admin.deleteUser(uid);

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? `  — ${r.info}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
