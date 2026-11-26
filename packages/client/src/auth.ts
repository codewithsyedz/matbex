/**
 * Auth client for the Matbex API (/auth/v1).
 *
 * Session = short-lived access JWT + rotating opaque refresh token, persisted
 * in the configured storage (localStorage in the browser, memory on servers).
 * Emits the same lifecycle events the app already listens for.
 */
import { AuthError } from "./errors";
import type {
  AuthChangeEvent,
  AuthenticatorAssuranceLevel,
  Session,
  StorageLike,
  Subscription,
  User,
  UserFactor,
} from "./types";

type Listener = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>;
type Result<T> = { data: T; error: AuthError | null };

const EXPIRY_MARGIN_S = 60;
const REFRESH_TICK_MS = 30_000;

class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const defaultStorage = (): StorageLike => {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch { /* access can throw in sandboxed iframes */ }
  return new MemoryStorage();
};

function decodeJwt(token: string): Record<string, any> {
  const part = token.split(".")[1];
  if (!part) throw new AuthError("Invalid JWT", 401);
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  return JSON.parse(decodeURIComponent(escape(json)));
}

export interface AuthClientConfig {
  url: string; // {api}/auth/v1
  headers: Record<string, string>;
  fetch: typeof fetch;
  storage?: StorageLike;
  storageKey: string;
  persistSession: boolean;
  autoRefreshToken: boolean;
  detectSessionInUrl: boolean;
}

export class AuthClient {
  private cfg: AuthClientConfig;
  private storage: StorageLike;
  private listeners = new Map<string, Listener>();
  private current: Session | null = null;
  private refreshing: Promise<Session | null> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private ready: Promise<void>;
  admin: AdminApi;
  mfa: MfaApi;

  constructor(cfg: AuthClientConfig) {
    this.cfg = cfg;
    this.storage = cfg.persistSession ? cfg.storage ?? defaultStorage() : new MemoryStorage();
    this.admin = new AdminApi(this);
    this.mfa = new MfaApi(this);
    this.ready = this.initialize();

    if (typeof window !== "undefined" && cfg.persistSession) {
      window.addEventListener?.("storage", (e) => {
        if (e.key !== cfg.storageKey) return;
        const next = e.newValue ? (JSON.parse(e.newValue) as Session) : null;
        const prev = this.current;
        this.current = next;
        if (!next && prev) this.emit("SIGNED_OUT", null);
        else if (next && !prev) this.emit("SIGNED_IN", next);
        else if (next) this.emit("TOKEN_REFRESHED", next);
      });
    }
  }

  // ---------------------------------------------------------------- internals
  /** @internal */
  async request<T = any>(
    path: string,
    init: { method?: string; body?: unknown; jwt?: string | null; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(`${this.cfg.url}${path}`);
    Object.entries(init.query ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers: Record<string, string> = { ...this.cfg.headers };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.jwt) headers["Authorization"] = `Bearer ${init.jwt}`;
    let res: Response;
    try {
      res = await this.cfg.fetch(url.toString(), {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch (e: any) {
      throw new AuthError(e?.message ?? "Network error", 0, "network_error");
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new AuthError(json.message ?? json.msg ?? json.error_description ?? json.error ?? res.statusText, res.status, json.code ?? json.error_code);
    }
    return json as T;
  }

  private async initialize() {
    if (this.cfg.detectSessionInUrl && typeof window !== "undefined" && window.location) {
      const fromUrl = await this.sessionFromUrl();
      if (fromUrl) return;
    }
    const raw = await this.storage.getItem(this.cfg.storageKey);
    if (raw) {
      try {
        this.current = JSON.parse(raw) as Session;
      } catch {
        await this.storage.removeItem(this.cfg.storageKey);
      }
    }
    if (this.current && this.isExpiring(this.current)) {
      await this.refresh().catch(() => this.clear());
    }
    this.startTicker();
  }

  /** Handles links from email (#access_token=...&type=recovery) and ?error=... */
  private async sessionFromUrl(): Promise<boolean> {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    if (!access || !refresh) return false;
    const type = hash.get("type");
    const user = await this.request<User>("/user", { jwt: access });
    const payload = decodeJwt(access);
    const session: Session = {
      access_token: access,
      refresh_token: refresh,
      token_type: "bearer",
      expires_in: Number(hash.get("expires_in") ?? payload.exp - Math.floor(Date.now() / 1000)),
      expires_at: payload.exp,
      user,
    };
    await this.save(session);
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch { /* ignore */ }
    this.startTicker();
    setTimeout(() => this.emit(type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", session), 0);
    return true;
  }

  private isExpiring(s: Session) {
    const exp = s.expires_at ?? decodeJwt(s.access_token).exp;
    return exp - Math.floor(Date.now() / 1000) < EXPIRY_MARGIN_S;
  }

  private startTicker() {
    if (!this.cfg.autoRefreshToken || this.ticker || typeof setInterval === "undefined") return;
    this.ticker = setInterval(() => {
      if (this.current && this.isExpiring(this.current)) this.refresh().catch(() => undefined);
    }, REFRESH_TICK_MS);
    (this.ticker as any).unref?.();
  }

  private async save(s: Session) {
    s.expires_at = s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in;
    this.current = s;
    await this.storage.setItem(this.cfg.storageKey, JSON.stringify(s));
  }

  private async clear() {
    this.current = null;
    await this.storage.removeItem(this.cfg.storageKey);
  }

  private emit(event: AuthChangeEvent, session: Session | null) {
    this.listeners.forEach((l) => {
      try {
        void l(event, session);
      } catch (e) {
        console.error("auth listener failed", e);
      }
    });
  }

  private async refresh(): Promise<Session | null> {
    if (this.refreshing) return this.refreshing;
    const rt = this.current?.refresh_token;
    if (!rt) return null;
    this.refreshing = (async () => {
      try {
        const s = await this.request<Session>("/token", { query: { grant_type: "refresh_token" }, body: { refresh_token: rt } });
        await this.save(s);
        this.emit("TOKEN_REFRESHED", s);
        return s;
      } catch (e) {
        if (e instanceof AuthError && e.status && e.status >= 400 && e.status < 500) {
          await this.clear();
          this.emit("SIGNED_OUT", null);
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Bearer passed via global headers (server-side "act as this user" clients). */
  private headerToken(): string | null {
    const h = this.cfg.headers["Authorization"] ?? this.cfg.headers["authorization"];
    return h ? h.replace(/^Bearer\s+/i, "") : null;
  }

  /** Access token to attach to API calls (refreshes when close to expiry). */
  async getAccessToken(): Promise<string | null> {
    await this.ready;
    if (!this.current) return null;
    if (this.isExpiring(this.current)) {
      try {
        await this.refresh();
      } catch {
        return null;
      }
    }
    return this.current?.access_token ?? null;
  }

  // ---------------------------------------------------------------- public API
  onAuthStateChange(cb: Listener): { data: { subscription: Subscription } } {
    const id = Math.random().toString(36).slice(2);
    this.listeners.set(id, cb);
    this.ready.then(() => {
      if (this.listeners.has(id)) void cb("INITIAL_SESSION", this.current);
    });
    return { data: { subscription: { id, unsubscribe: () => this.listeners.delete(id) } } };
  }

  async getSession(): Promise<Result<{ session: Session | null }>> {
    await this.ready;
    if (this.current && this.isExpiring(this.current)) {
      try {
        await this.refresh();
      } catch (e) {
        return { data: { session: null }, error: e as AuthError };
      }
    }
    return { data: { session: this.current }, error: null };
  }

  async getUser(jwt?: string): Promise<Result<{ user: User | null }>> {
    try {
      const token = jwt ?? (await this.getAccessToken()) ?? this.headerToken();
      if (!token) return { data: { user: null }, error: new AuthError("Auth session missing!", 401, "session_missing") };
      const user = await this.request<User>("/user", { jwt: token });
      return { data: { user }, error: null };
    } catch (e) {
      return { data: { user: null }, error: e as AuthError };
    }
  }

  /** Verifies a JWT server-side and returns its claims. */
  async getClaims(jwt?: string): Promise<Result<{ claims: Record<string, any> } | null>> {
    try {
      const token = jwt ?? (await this.getAccessToken()) ?? this.headerToken();
      if (!token) return { data: null, error: new AuthError("Auth session missing!", 401) };
      const out = await this.request<{ claims: Record<string, any> }>("/claims", { jwt: token });
      return { data: { claims: out.claims }, error: null };
    } catch (e) {
      return { data: null, error: e as AuthError };
    }
  }

  async signInWithPassword(creds: { email?: string; phone?: string; password: string }): Promise<Result<{ user: User | null; session: Session | null }>> {
    try {
      const s = await this.request<Session>("/token", { query: { grant_type: "password" }, body: creds });
      await this.save(s);
      this.startTicker();
      this.emit("SIGNED_IN", s);
      return { data: { user: s.user, session: s }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: e as AuthError };
    }
  }

  async signUp(creds: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }): Promise<Result<{ user: User | null; session: Session | null }>> {
    try {
      const out = await this.request<{ user: User; session: Session | null }>("/signup", {
        body: { email: creds.email, password: creds.password, data: creds.options?.data ?? {}, redirect_to: creds.options?.emailRedirectTo },
      });
      if (out.session) {
        await this.save(out.session);
        this.emit("SIGNED_IN", out.session);
      }
      return { data: out, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: e as AuthError };
    }
  }

  async signOut(opts: { scope?: "global" | "local" | "others" } = {}): Promise<{ error: AuthError | null }> {
    const token = this.current?.access_token;
    if (token && opts.scope !== "local") {
      await this.request("/logout", { method: "POST", jwt: token, query: { scope: opts.scope ?? "global" } }).catch(() => undefined);
    }
    if (opts.scope !== "others") {
      await this.clear();
      this.emit("SIGNED_OUT", null);
    }
    return { error: null };
  }

  async refreshSession(current?: { refresh_token: string }): Promise<Result<{ user: User | null; session: Session | null }>> {
    try {
      if (current?.refresh_token && current.refresh_token !== this.current?.refresh_token) {
        this.current = { ...(this.current as Session), refresh_token: current.refresh_token };
      }
      const s = await this.refresh();
      return { data: { user: s?.user ?? null, session: s }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: e as AuthError };
    }
  }

  async setSession(tokens: { access_token: string; refresh_token: string }): Promise<Result<{ user: User | null; session: Session | null }>> {
    try {
      const payload = decodeJwt(tokens.access_token);
      const user = await this.request<User>("/user", { jwt: tokens.access_token });
      const s: Session = {
        ...tokens,
        token_type: "bearer",
        expires_in: payload.exp - Math.floor(Date.now() / 1000),
        expires_at: payload.exp,
        user,
      };
      await this.save(s);
      this.startTicker();
      this.emit("SIGNED_IN", s);
      return { data: { user, session: s }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: e as AuthError };
    }
  }

  async resetPasswordForEmail(email: string, opts: { redirectTo?: string } = {}): Promise<Result<Record<string, never>>> {
    try {
      await this.request("/recover", { body: { email, redirect_to: opts.redirectTo } });
      return { data: {}, error: null };
    } catch (e) {
      return { data: {}, error: e as AuthError };
    }
  }

  async updateUser(attrs: { email?: string; password?: string; data?: Record<string, unknown>; nonce?: string }): Promise<Result<{ user: User | null }>> {
    try {
      const token = await this.getAccessToken();
      if (!token) throw new AuthError("Auth session missing!", 401);
      const user = await this.request<User>("/user", { method: "PUT", jwt: token, body: attrs });
      if (this.current) {
        await this.save({ ...this.current, user });
        this.emit("USER_UPDATED", this.current);
      }
      return { data: { user }, error: null };
    } catch (e) {
      return { data: { user: null }, error: e as AuthError };
    }
  }

  /** Email OTP / token-hash verification (signup, recovery, invite, magiclink, email_change). */
  async verifyOtp(params: { email?: string; token?: string; token_hash?: string; type: string }): Promise<Result<{ user: User | null; session: Session | null }>> {
    try {
      const s = await this.request<Session>("/verify", { body: params });
      await this.save(s);
      this.startTicker();
      this.emit(params.type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", s);
      return { data: { user: s.user, session: s }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: e as AuthError };
    }
  }

  /** @internal used by MFA verify to swap in the aal2 session */
  async _adoptSession(s: Session, event: AuthChangeEvent) {
    await this.save(s);
    this.emit(event, s);
  }
  /** @internal */
  _currentSession() {
    return this.current;
  }
  /** @internal */
  _decode(token: string) {
    return decodeJwt(token);
  }
}

class MfaApi {
  constructor(private auth: AuthClient) {}

  private async jwt() {
    const t = await this.auth.getAccessToken();
    if (!t) throw new AuthError("Auth session missing!", 401);
    return t;
  }

  async listFactors(): Promise<{ data: { all: UserFactor[]; totp: UserFactor[] } | null; error: AuthError | null }> {
    try {
      const all = await this.auth.request<UserFactor[]>("/factors", { jwt: await this.jwt() });
      return { data: { all, totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified") }, error: null };
    } catch (e) {
      return { data: null, error: e as AuthError };
    }
  }

  async enroll(p: { factorType: "totp"; friendlyName?: string; issuer?: string }) {
    try {
      const data = await this.auth.request<{ id: string; type: "totp"; totp: { qr_code: string; secret: string; uri: string } }>(
        "/factors",
        { jwt: await this.jwt(), body: { factor_type: p.factorType, friendly_name: p.friendlyName, issuer: p.issuer } },
      );
      return { data, error: null };
    } catch (e) {
      return { data: null as any, error: e as AuthError };
    }
  }

  async challenge(p: { factorId: string }) {
    try {
      const data = await this.auth.request<{ id: string; expires_at: number }>(`/factors/${p.factorId}/challenge`, {
        method: "POST",
        jwt: await this.jwt(),
      });
      return { data, error: null };
    } catch (e) {
      return { data: null as any, error: e as AuthError };
    }
  }

  async verify(p: { factorId: string; challengeId: string; code: string }) {
    try {
      const s = await this.auth.request<Session>(`/factors/${p.factorId}/verify`, {
        jwt: await this.jwt(),
        body: { challenge_id: p.challengeId, code: p.code },
      });
      await this.auth._adoptSession(s, "MFA_CHALLENGE_VERIFIED");
      return { data: s, error: null };
    } catch (e) {
      return { data: null as any, error: e as AuthError };
    }
  }

  async challengeAndVerify(p: { factorId: string; code: string }) {
    const c = await this.challenge({ factorId: p.factorId });
    if (c.error) return { data: null as any, error: c.error };
    return this.verify({ factorId: p.factorId, challengeId: c.data.id, code: p.code });
  }

  async unenroll(p: { factorId: string }) {
    try {
      await this.auth.request(`/factors/${p.factorId}`, { method: "DELETE", jwt: await this.jwt() });
      return { data: { id: p.factorId }, error: null };
    } catch (e) {
      return { data: null as any, error: e as AuthError };
    }
  }

  async getAuthenticatorAssuranceLevel(): Promise<{
    data: { currentLevel: AuthenticatorAssuranceLevel | null; nextLevel: AuthenticatorAssuranceLevel | null; currentAuthenticationMethods: any[] } | null;
    error: AuthError | null;
  }> {
    const s = this.auth._currentSession();
    if (!s) return { data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] }, error: null };
    const claims = this.auth._decode(s.access_token);
    const verified = (s.user.factors ?? []).some((f) => f.status === "verified");
    return {
      data: {
        currentLevel: (claims.aal as AuthenticatorAssuranceLevel) ?? "aal1",
        nextLevel: verified ? "aal2" : "aal1",
        currentAuthenticationMethods: claims.amr ?? [],
      },
      error: null,
    };
  }
}

/** Service-role only. The API rejects these calls for normal user tokens. */
class AdminApi {
  constructor(private auth: AuthClient) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
    try {
      const data = await this.auth.request<T>(`/admin${path}`, init);
      return { data, error: null as AuthError | null };
    } catch (e) {
      return { data: null as any, error: e as AuthError };
    }
  }

  async createUser(attrs: {
    email?: string;
    phone?: string;
    password?: string;
    email_confirm?: boolean;
    phone_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  }) {
    const r = await this.call<User>("/users", { body: attrs });
    return { data: { user: r.data as User | null }, error: r.error };
  }

  async getUserById(id: string) {
    const r = await this.call<User>(`/users/${id}`);
    return { data: { user: r.data as User | null }, error: r.error };
  }

  async updateUserById(id: string, attrs: Record<string, unknown>) {
    const r = await this.call<User>(`/users/${id}`, { method: "PUT", body: attrs });
    return { data: { user: r.data as User | null }, error: r.error };
  }

  async deleteUser(id: string) {
    const r = await this.call<Record<string, never>>(`/users/${id}`, { method: "DELETE" });
    return { data: { user: null }, error: r.error };
  }

  async listUsers(params: { page?: number; perPage?: number } = {}) {
    const r = await this.call<{ users: User[]; total: number }>("/users", {
      query: { page: String(params.page ?? 1), per_page: String(params.perPage ?? 50) },
    });
    return { data: { users: r.data?.users ?? [], total: r.data?.total ?? 0, aud: "authenticated" }, error: r.error };
  }

  async generateLink(params: { type: "signup" | "invite" | "magiclink" | "recovery" | "email_change_current" | "email_change_new"; email: string; password?: string; options?: { redirectTo?: string; data?: Record<string, unknown> } }) {
    const r = await this.call<{ properties: { action_link: string; hashed_token: string; email_otp: string; redirect_to: string; verification_type: string }; user: User }>(
      "/generate_link",
      { body: { type: params.type, email: params.email, password: params.password, redirect_to: params.options?.redirectTo, data: params.options?.data } },
    );
    return { data: r.data ?? { properties: null, user: null }, error: r.error };
  }

  async inviteUserByEmail(email: string, opts: { redirectTo?: string; data?: Record<string, unknown> } = {}) {
    const r = await this.call<User>("/invite", { body: { email, redirect_to: opts.redirectTo, data: opts.data } });
    return { data: { user: r.data as User | null }, error: r.error };
  }

  async signOut(jwt: string, scope: "global" | "local" | "others" = "global") {
    try {
      await this.auth.request("/logout", { method: "POST", jwt, query: { scope } });
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: e as AuthError };
    }
  }
}
