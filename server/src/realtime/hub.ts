/**
 * /realtime/v1/websocket — row-change and broadcast fan-out.
 *
 * Source of truth: Postgres NOTIFY on channel `realtime_changes`, emitted by
 * realtime.notify_change() triggers on every table in the realtime
 * publication. Before delivering an INSERT/UPDATE to a subscriber the row is
 * re-read as that subscriber (asCaller), so RLS decides who sees what.
 * DELETE events carry only the primary key.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { asCaller, sql, type DbClaims } from "../db.js";
import { verify, type AccessClaims } from "../lib/jwt.js";

interface ChangeFilter {
  event: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  table?: string;
  filter?: string;
}
interface Sub {
  topic: string;
  changes: ChangeFilter[];
  broadcast: boolean;
}
interface Conn {
  ws: WebSocket;
  claims: DbClaims;
  subs: Map<string, Sub>;
}
interface DbEvent {
  schema: string;
  table: string;
  type: "INSERT" | "UPDATE" | "DELETE";
  id: string | null;
  commit_timestamp: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
  truncated?: boolean;
}

const conns = new Set<Conn>();
const IDENT = /^[a-z_][a-z0-9_]*$/i;

const anon: DbClaims = { role: "anon" };

async function toClaims(token: string | null | undefined): Promise<DbClaims> {
  if (!token) return anon;
  try {
    const c = await verify<AccessClaims>(token);
    return c as unknown as DbClaims;
  } catch {
    return anon;
  }
}

/** Supports the `col=op.value` filters the app uses (eq, neq, lt, lte, gt, gte, in). */
function passesFilter(filter: string | undefined, row: Record<string, unknown> | null | undefined): boolean {
  if (!filter) return true;
  if (!row) return true; // cannot evaluate (truncated) — RLS re-read still applies
  const m = /^([a-z0-9_]+)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$/i.exec(filter);
  if (!m) return true;
  const [, col, op, raw] = m;
  const v = row[col];
  const s = v === null || v === undefined ? "null" : String(v);
  switch (op) {
    case "eq": return s === raw;
    case "neq": return s !== raw;
    case "lt": return Number(v) < Number(raw);
    case "lte": return Number(v) <= Number(raw);
    case "gt": return Number(v) > Number(raw);
    case "gte": return Number(v) >= Number(raw);
    case "in": return raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")).includes(s);
  }
  return true;
}

function wants(f: ChangeFilter, e: DbEvent) {
  return (f.event === "*" || f.event === e.type) && (!f.schema || f.schema === "*" || f.schema === e.schema) && (!f.table || f.table === "*" || f.table === e.table);
}

const send = (c: Conn, msg: unknown) => {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
};

async function dispatch(e: DbEvent) {
  if (!IDENT.test(e.schema) || !IDENT.test(e.table)) return;
  // Collect (connection, topic) pairs interested in this event.
  const targets: { c: Conn; topic: string; filter: ChangeFilter }[] = [];
  for (const c of conns) {
    for (const sub of c.subs.values()) {
      const f = sub.changes.find((x) => wants(x, e) && passesFilter(x.filter, e.record ?? e.old_record));
      if (f) targets.push({ c, topic: sub.topic, filter: f });
    }
  }
  if (!targets.length) return;

  if (e.type === "DELETE") {
    const old = e.old_record ?? (e.id ? { id: e.id } : {});
    for (const t of targets) {
      // Without the row we can only scope deletes by the pre-filter; send keys only.
      send(t.c, {
        type: "change",
        topic: t.topic,
        payload: { schema: e.schema, table: e.table, commit_timestamp: e.commit_timestamp, eventType: "DELETE", new: {}, old: { id: (old as any).id }, errors: null },
      });
    }
    return;
  }

  // Re-read once per distinct identity, as that identity (RLS enforced).
  const cache = new Map<string, Record<string, unknown> | null>();
  for (const t of targets) {
    const key = `${t.c.claims.role}:${t.c.claims.sub ?? ""}`;
    if (!cache.has(key)) {
      if (!e.id) {
        cache.set(key, null);
      } else {
        try {
          const row = await asCaller(t.c.claims, async (tx) => {
            // Only the columns this role may read: "select *" fails on tables with column-level
            // grants (zatca_devices hides its keys), which would silently drop the event.
            const [cols] = await tx<{ list: string | null }[]>`
              select string_agg(quote_ident(a.attname), ', ' order by a.attnum) as list
              from pg_attribute a
              where a.attrelid = format('%I.%I', ${e.schema}::text, ${e.table}::text)::regclass
                and a.attnum > 0 and not a.attisdropped
                and has_column_privilege(a.attrelid, a.attnum, 'SELECT')`;
            if (!cols?.list) return null;
            const [r] = await tx.unsafe(`select ${cols.list} from "${e.schema}"."${e.table}" where id = $1`, [e.id as string]);
            return (r as Record<string, unknown>) ?? null;
          });
          cache.set(key, row);
        } catch {
          cache.set(key, null);
        }
      }
    }
    const row = cache.get(key);
    if (!row || !passesFilter(t.filter.filter, row)) continue;
    send(t.c, {
      type: "change",
      topic: t.topic,
      payload: {
        schema: e.schema,
        table: e.table,
        commit_timestamp: e.commit_timestamp,
        eventType: e.type,
        new: row,
        old: e.type === "UPDATE" ? { id: e.id } : {},
        errors: null,
      },
    });
  }
}

export async function realtimeRoutes(app: FastifyInstance) {
  await sql.listen("realtime_changes", (payload) => {
    try {
      void dispatch(JSON.parse(payload) as DbEvent).catch((err) => app.log.error({ err }, "realtime dispatch failed"));
    } catch (err) {
      app.log.error({ err }, "bad realtime payload");
    }
  });

  app.get<{ Querystring: { token?: string } }>("/websocket", { websocket: true }, async (socket, req) => {
    const conn: Conn = { ws: socket, claims: await toClaims(req.query.token), subs: new Map() };
    conns.add(conn);

    socket.on("message", async (raw: Buffer) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (m.type) {
        case "ping":
          send(conn, { type: "pong" });
          break;
        case "token":
          conn.claims = await toClaims(m.token);
          break;
        case "subscribe":
          if (typeof m.topic !== "string") return;
          conn.subs.set(m.topic, {
            topic: m.topic,
            changes: Array.isArray(m.changes) ? m.changes : [],
            broadcast: !!m.broadcast,
          });
          send(conn, { type: "subscribed", topic: m.topic });
          break;
        case "unsubscribe":
          conn.subs.delete(m.topic);
          break;
        case "broadcast":
          if (conn.claims.role === "anon") return send(conn, { type: "error", topic: m.topic, message: "broadcast requires auth" });
          for (const other of conns) {
            if (other !== conn && other.subs.get(m.topic)?.broadcast) {
              send(other, { type: "broadcast", topic: m.topic, event: m.event, payload: m.payload });
            }
          }
          break;
      }
    });
    socket.on("close", () => conns.delete(conn));
  });
}
