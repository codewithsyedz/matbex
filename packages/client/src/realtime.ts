/**
 * Realtime client: one WebSocket to {api}/realtime/v1/websocket, multiplexing
 * channels. Supports `postgres_changes` (row changes, RLS-filtered on the
 * server) and `broadcast` (fan-out messages between clients on a topic).
 *
 * Wire protocol (JSON):
 *   → {type:"subscribe", topic, changes:[{event,schema,table,filter}], broadcast:boolean}
 *   → {type:"unsubscribe", topic} | {type:"broadcast", topic, event, payload}
 *   → {type:"token", token} | {type:"ping"}
 *   ← {type:"subscribed"|"error", topic, message?}
 *   ← {type:"change", topic, payload} | {type:"broadcast", topic, event, payload} | {type:"pong"}
 */

type ChangeEvent = "*" | "INSERT" | "UPDATE" | "DELETE";
interface ChangeFilter {
  event: ChangeEvent;
  schema?: string;
  table?: string;
  filter?: string;
}
export interface ChangePayload<T = any> {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
  errors: null;
}
type Status = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

const matches = (f: ChangeFilter, p: ChangePayload) => {
  if (f.event !== "*" && f.event !== p.eventType) return false;
  if (f.schema && f.schema !== "*" && f.schema !== p.schema) return false;
  if (f.table && f.table !== "*" && f.table !== p.table) return false;
  return true;
};

export class RealtimeChannel {
  topic: string;
  state: "closed" | "joining" | "joined" = "closed";
  private changes: { filter: ChangeFilter; cb: (p: ChangePayload) => void }[] = [];
  private broadcasts: { event: string; cb: (m: any) => void }[] = [];
  private statusCb?: (status: Status, err?: Error) => void;

  constructor(private rt: RealtimeClient, name: string) {
    this.topic = name.startsWith("realtime:") ? name : `realtime:${name}`;
  }

  on(type: "postgres_changes", filter: ChangeFilter, cb: (payload: ChangePayload) => void): this;
  on(type: "broadcast", filter: { event: string }, cb: (msg: { type: "broadcast"; event: string; payload: any }) => void): this;
  on(type: "presence" | "system", filter: any, cb: (...a: any[]) => void): this;
  on(type: string, filter: any, cb: (...a: any[]) => void): this {
    if (type === "postgres_changes") this.changes.push({ filter, cb });
    else if (type === "broadcast") this.broadcasts.push({ event: filter?.event ?? "*", cb });
    return this;
  }

  subscribe(cb?: (status: Status, err?: Error) => void): this {
    this.statusCb = cb;
    this.state = "joining";
    this.rt._join(this);
    return this;
  }

  async send(msg: { type: "broadcast"; event: string; payload?: any }): Promise<"ok" | "error"> {
    return this.rt._send({ type: "broadcast", topic: this.topic, event: msg.event, payload: msg.payload }) ? "ok" : "error";
  }

  async unsubscribe(): Promise<"ok"> {
    this.rt._leave(this);
    this.state = "closed";
    this.statusCb?.("CLOSED");
    return "ok";
  }

  /** @internal */
  _joinMessage() {
    return {
      type: "subscribe",
      topic: this.topic,
      changes: this.changes.map((c) => c.filter),
      broadcast: this.broadcasts.length > 0,
    };
  }
  /** @internal */
  _onMessage(m: any) {
    if (m.type === "subscribed") {
      this.state = "joined";
      this.statusCb?.("SUBSCRIBED");
    } else if (m.type === "error") {
      this.statusCb?.("CHANNEL_ERROR", new Error(m.message ?? "channel error"));
    } else if (m.type === "change") {
      for (const c of this.changes) if (matches(c.filter, m.payload)) c.cb(m.payload);
    } else if (m.type === "broadcast") {
      for (const b of this.broadcasts) if (b.event === "*" || b.event === m.event) b.cb({ type: "broadcast", event: m.event, payload: m.payload });
    }
  }
  /** @internal */
  _closed() {
    if (this.state !== "closed") this.statusCb?.("TIMED_OUT");
    this.state = "joining";
  }
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private channels = new Map<string, RealtimeChannel>();
  private backoff = 1000;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private connecting = false;

  constructor(private wsUrl: string, private token: () => Promise<string | null>) {}

  channel(name: string, _opts?: unknown) {
    const ch = new RealtimeChannel(this, name);
    return ch;
  }

  getChannels() {
    return [...this.channels.values()];
  }

  async removeChannel(ch: RealtimeChannel) {
    await ch.unsubscribe();
    return "ok" as const;
  }

  async removeAllChannels() {
    await Promise.all(this.getChannels().map((c) => c.unsubscribe()));
    return ["ok" as const];
  }

  /** Push a fresh access token to the server (called on refresh). */
  setAuth(token: string | null) {
    if (token) this._send({ type: "token", token });
  }

  /** @internal */
  _join(ch: RealtimeChannel) {
    this.channels.set(ch.topic, ch);
    if (this.ws?.readyState === 1) this._send(ch._joinMessage());
    else void this.connect();
  }
  /** @internal */
  _leave(ch: RealtimeChannel) {
    this.channels.delete(ch.topic);
    this._send({ type: "unsubscribe", topic: ch.topic });
    if (this.channels.size === 0) this.disconnect();
  }
  /** @internal */
  _send(msg: unknown): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private async connect() {
    if (this.connecting || this.ws?.readyState === 1 || typeof WebSocket === "undefined") return;
    this.connecting = true;
    const token = await this.token();
    const url = `${this.wsUrl}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connecting = false;
      this.backoff = 1000;
      this.channels.forEach((c) => this._send(c._joinMessage()));
      this.heartbeat = setInterval(() => this._send({ type: "ping" }), 25_000);
    };
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.topic) this.channels.get(m.topic)?._onMessage(m);
    };
    ws.onclose = () => {
      this.connecting = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      this.channels.forEach((c) => c._closed());
      if (this.channels.size > 0) {
        setTimeout(() => void this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private disconnect() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.close();
    this.ws = null;
  }
}
