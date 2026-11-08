/**
 * @matbex/client — the single entry point for talking to the Matbex API.
 *
 *   const db = createClient(API_URL);                 // browser (user session)
 *   const admin = createClient(API_URL, SERVICE_KEY); // server (service role)
 *
 *   db.from("table").select("*").eq("id", x)          // data API
 *   db.rpc("fn", args)                                // SQL functions
 *   db.auth.signInWithPassword({...})                 // auth
 *   db.storage.from("bucket").upload(path, file)      // object storage
 *   db.functions.invoke("name", { body })             // server functions
 *   db.channel("x").on("postgres_changes", ...)       // realtime
 */
import { AuthClient } from "./auth";
import { FunctionsClient } from "./functions";
import { rpcBuilder, TableBuilder } from "./query";
import { RealtimeClient } from "./realtime";
import { StorageClient } from "./storage";
import type { ClientOptions } from "./types";

export * from "./errors";
export * from "./types";
export type { QueryResult } from "./query";
export type { ChangePayload, RealtimeChannel } from "./realtime";

export class MatbexClient<_Database = any> {
  readonly url: string;
  readonly auth: AuthClient;
  readonly storage: StorageClient;
  readonly functions: FunctionsClient;
  readonly realtime: RealtimeClient;
  private restUrl: string;
  private baseHeaders: Record<string, string>;
  private fetchImpl: typeof fetch;
  private schemaName?: string;
  private staticKey?: string;

  constructor(url: string, key?: string, opts: ClientOptions = {}) {
    if (!url) throw new Error("@matbex/client: API url is required (set VITE_API_URL / API_URL)");
    this.url = url.replace(/\/+$/, "");
    this.restUrl = `${this.url}/rest/v1`;
    this.schemaName = opts.db?.schema;
    this.fetchImpl = opts.global?.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    // A service/role key is a JWT; public client keys are not sent as bearer.
    this.staticKey = key && key.split(".").length === 3 ? key : undefined;
    this.baseHeaders = { "X-Client-Info": "matbex-client/1", ...(opts.global?.headers ?? {}) };
    if (key) this.baseHeaders["apikey"] = key;

    const host = typeof window !== "undefined" ? window.location?.hostname ?? "app" : "server";
    this.auth = new AuthClient({
      url: `${this.url}/auth/v1`,
      headers: this.staticKey ? { ...this.baseHeaders, Authorization: `Bearer ${this.staticKey}` } : this.baseHeaders,
      fetch: this.fetchImpl,
      storage: opts.auth?.storage,
      storageKey: opts.auth?.storageKey ?? `matbex-auth-${host}`,
      persistSession: opts.auth?.persistSession ?? typeof window !== "undefined",
      autoRefreshToken: opts.auth?.autoRefreshToken ?? typeof window !== "undefined",
      detectSessionInUrl: opts.auth?.detectSessionInUrl ?? typeof window !== "undefined",
    });

    const authed = this.authedFetch;
    this.storage = new StorageClient(`${this.url}/storage/v1`, authed);
    this.functions = new FunctionsClient(`${this.url}/functions/v1`, authed);
    const wsBase = this.url.replace(/^http/, "ws");
    this.realtime = new RealtimeClient(`${wsBase}/realtime/v1/websocket`, () => this.bearer());
    this.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") this.realtime.setAuth(session?.access_token ?? null);
    });
  }

  /** Explicit Authorization header (e.g. forwarded user JWT) wins over session. */
  private async bearer(): Promise<string | null> {
    const explicit = this.baseHeaders["Authorization"] ?? this.baseHeaders["authorization"];
    if (explicit) return explicit.replace(/^Bearer\s+/i, "");
    return (await this.auth.getAccessToken()) ?? this.staticKey ?? null;
  }

  private authedFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    Object.entries(this.baseHeaders).forEach(([k, v]) => {
      if (!headers.has(k)) headers.set(k, v);
    });
    if (!headers.has("Authorization")) {
      const token = await this.bearer();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return this.fetchImpl(input, { ...init, headers });
  };

  from(table: string) {
    return new TableBuilder(new URL(`${this.restUrl}/${table}`), {}, this.authedFetch as typeof fetch, this.schemaName);
  }

  rpc(fn: string, args: Record<string, unknown> = {}, opts: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" } = {}) {
    return rpcBuilder(this.restUrl, fn, args, opts, {}, this.authedFetch as typeof fetch, this.schemaName);
  }

  /** Query another exposed schema. */
  schema(name: string): MatbexClient<_Database> {
    const c = Object.create(this) as MatbexClient<_Database>;
    (c as any).schemaName = name;
    return c;
  }

  channel(name: string, opts?: unknown) {
    return this.realtime.channel(name, opts);
  }
  getChannels() {
    return this.realtime.getChannels();
  }
  removeChannel(ch: ReturnType<RealtimeClient["channel"]>) {
    return this.realtime.removeChannel(ch);
  }
  removeAllChannels() {
    return this.realtime.removeAllChannels();
  }
}

export function createClient<Database = any>(url: string, key?: string, opts: ClientOptions = {}) {
  return new MatbexClient<Database>(url, key, opts);
}

/** Back-compat type alias for code that annotated the client type. */
export type DbClient = MatbexClient<any>;
