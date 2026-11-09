/**
 * Live business events (kitchen tickets, ...) over Socket.IO, fed by the server's
 * transactional outbox (docs/self-hosting/ARCHITECTURE.md, "Realtime").
 *
 *   const off = subscribeEvents("kds", restaurantId, (e) => ..., () => refetch());
 *   off();
 *
 * Treat an event as "this changed, refresh": delivery is at-least-once and ordering is
 * best-effort. `onResync` runs after every (re)connect, because events sent while the
 * device was offline are not replayed; refetching closes that gap.
 *
 * One shared connection per page. It authenticates with the current access token, reconnects
 * when the token is refreshed, and disconnects on sign-out.
 */
import { io, type Socket } from "socket.io-client";
import { db } from "./client";
import { API_URL } from "./config";

export type EventTopic = "kds";

export interface AppEvent<P = Record<string, any>> {
  id: number;
  type: string;
  restaurantId: string;
  aggregateId: string | null;
  payload: P;
  at: string;
}

interface Subscription {
  topic: EventTopic;
  restaurantId: string;
  handler: (e: AppEvent) => void;
  onResync?: () => void;
}

const subs = new Set<Subscription>();
let socket: Socket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

const roomKey = (s: { topic: string; restaurantId: string }) => `${s.topic}:${s.restaurantId}`;

function scheduleReconnect(ms: number) {
  if (retry || subs.size === 0) return;
  retry = setTimeout(() => {
    retry = null;
    if (subs.size && socket && !socket.connected) socket.connect();
  }, ms);
}

function joinAll(s: Socket) {
  const rooms = new Map<string, Subscription>();
  subs.forEach((sub) => rooms.set(roomKey(sub), sub));
  rooms.forEach((sub) => s.emit("subscribe", { topic: sub.topic, restaurantId: sub.restaurantId }));
}

function ensureSocket(): Socket {
  if (socket) return socket;
  const s = io(API_URL, {
    path: "/socket.io",
    // Websocket only: no sticky sessions needed when several API instances run.
    transports: ["websocket"],
    autoConnect: false,
    reconnectionDelayMax: 10_000,
    auth: (cb) => {
      void db.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token ?? "" }));
    },
  });

  s.on("connect", () => {
    joinAll(s);
    subs.forEach((sub) => sub.onResync?.());
  });
  // Auth errors and server-side disconnects (token expiry) are not retried by socket.io itself.
  s.on("connect_error", () => scheduleReconnect(5_000));
  s.on("disconnect", (reason) => {
    if (reason === "io server disconnect") scheduleReconnect(1_000);
  });
  s.onAny((topic: string, event: AppEvent) => {
    subs.forEach((sub) => {
      if (sub.topic === topic && sub.restaurantId === event?.restaurantId) sub.handler(event);
    });
  });

  db.auth.onAuthStateChange((evt) => {
    if (evt === "SIGNED_OUT") {
      s.disconnect();
    } else if ((evt === "TOKEN_REFRESHED" || evt === "SIGNED_IN") && subs.size) {
      // Reconnect so the server checks the new token.
      s.disconnect();
      s.connect();
    }
  });

  socket = s;
  return s;
}

export function subscribeEvents(
  topic: EventTopic,
  restaurantId: string,
  handler: (e: AppEvent) => void,
  onResync?: () => void,
): () => void {
  const s = ensureSocket();
  const sub: Subscription = { topic, restaurantId, handler, onResync };
  subs.add(sub);
  if (s.connected) s.emit("subscribe", { topic, restaurantId });
  else if (!s.active) s.connect();

  return () => {
    subs.delete(sub);
    const stillUsed = [...subs].some((o) => roomKey(o) === roomKey(sub));
    if (!stillUsed && s.connected) s.emit("unsubscribe", { topic, restaurantId });
    if (subs.size === 0) s.disconnect();
  };
}
