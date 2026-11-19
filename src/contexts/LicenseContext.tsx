import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { getTerminalId } from "@/lib/offline/terminal";
import { Capacitor } from "@capacitor/core";
import { useDevicePresencePing } from "@/hooks/useDevicePresencePing";

export type LicenseMode = "loading" | "active" | "grace" | "limited" | "locked" | "no_seat" | "offline_stale";

export interface LicenseDevice {
  id: string;
  device_label: string | null;
  platform: string | null;
  last_seen_at: string;
  terminal_id: string;
}

export interface LicenseState {
  mode: LicenseMode;
  subscriptionStatus: string;
  graceEndsAt: string | null;
  periodEnd: string | null;
  seatCap?: number;
  activeDevices?: LicenseDevice[];
  checkedAt: number;
  reason?: string | null;
}

interface LicenseContextValue extends LicenseState {
  isActive: boolean;
  isGrace: boolean;
  isLimited: boolean;
  isLocked: boolean;
  noSeat: boolean;
  posWriteDisabled: boolean;
  refresh: () => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<{ ok: boolean; error?: string }>;
}

const STORAGE_KEY = "license_state_v1";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const OFFLINE_TRUST_MS = 72 * 60 * 60 * 1000;

export const LicenseContext = createContext<LicenseContextValue | undefined>(undefined);

function readCache(): LicenseState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseState;
  } catch {
    return null;
  }
}

function writeCache(s: LicenseState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { user, restaurant } = useAuth();
  const initial = readCache();
  const [state, setState] = useState<LicenseState>(
    initial ?? {
      mode: "loading",
      subscriptionStatus: "unknown",
      graceEndsAt: null,
      periodEnd: null,
      checkedAt: 0,
    },
  );
  const timerRef = useRef<number | null>(null);

  const run = useCallback(async (trigger: "boot" | "interval" | "online" | "manual" = "manual") => {
    if (!user || !restaurant?.id) return;
    // No live session → don't call the edge function (it would 401 with
    // "Invalid auth" and surface as a blank-screen runtime error).
    let { data: { session } } = await db.auth.getSession();
    if (!session?.access_token) return;
    // Refresh proactively if the token is expired or expiring within 30s -
    // the SDK will otherwise send the stale token and validate-license
    // returns 401 "Invalid auth", which the runtime error sink reports as
    // a blank-screen runtime error.
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt && expiresAt - Date.now() < 30_000) {
      const { data: refreshed } = await db.auth.refreshSession();
      if (!refreshed?.session?.access_token) return;
      session = refreshed.session;
    }
    // Final server-side probe; bail silently if it still fails.
    const { data: probe, error: probeErr } = await db.auth.getUser();
    if (probeErr || !probe?.user) return;
    const { appendLicenseDebugEntry } = await import("@/lib/offline/licenseDebugLog");
    const { getDeviceFingerprint } = await import("@/lib/offline/deviceFingerprint");
    const terminalId = await getTerminalId();
    const deviceFingerprint = await getDeviceFingerprint();
    if (!navigator.onLine) {
      // Stay on cached value; degrade if stale > 72h
      const cached = readCache();
      if (cached && Date.now() - cached.checkedAt > OFFLINE_TRUST_MS) {
        setState({ ...cached, mode: "offline_stale" });
      }
      appendLicenseDebugEntry({
        ts: Date.now(),
        event: "offline_stale",
        mode: cached?.mode ?? "loading",
        detail: "Skipped validate-license: navigator offline.",
        seatId: null,
        terminalId,
        fingerprintShort: deviceFingerprint.slice(0, 10),
        trigger,
      });
      return;
    }
    try {
      const invokeOnce = async (accessToken: string) =>
        db.functions.invoke("validate-license", {
          headers: { Authorization: `Bearer ${accessToken}` },
          body: {
            terminal_id: terminalId,
            restaurant_id: restaurant.id,
            device_label: navigator.userAgent.slice(0, 80),
            user_agent: navigator.userAgent,
            platform: Capacitor.getPlatform(),
            device_fingerprint: deviceFingerprint,
          },
        });

      let { data, error } = await invokeOnce(session.access_token);
      if (error) {
        // A 401 here means the token went stale between the probe and the
        // call. Refresh once and retry before treating it as a failure.
        const { data: refreshed } = await db.auth.refreshSession();
        const retryToken = refreshed?.session?.access_token;
        if (!retryToken) return;
        ({ data, error } = await invokeOnce(retryToken));
      }
      if (error) throw error;

      const next: LicenseState = {
        mode: (data?.mode ?? "limited") as LicenseMode,
        subscriptionStatus: data?.subscription_status ?? "unknown",
        graceEndsAt: data?.grace_ends_at ?? null,
        periodEnd: data?.current_period_end ?? null,
        seatCap: data?.seat_cap,
        activeDevices: data?.active_devices,
        reason: data?.reason ?? null,
        checkedAt: Date.now(),
      };
      setState(next);
      writeCache(next);
      appendLicenseDebugEntry({
        ts: Date.now(),
        event:
          next.mode === "no_seat"
            ? "no_seat"
            : ((data?.seat_event ?? "matched_terminal") as never),
        mode: next.mode,
        detail:
          data?.seat_event_detail ??
          next.reason ??
          (next.mode === "active"
            ? "Existing seat for this terminal id reused."
            : null),
        seatId: (data?.seat?.id as string) ?? null,
        terminalId,
        fingerprintShort: deviceFingerprint.slice(0, 10),
        trigger,
      });
    } catch (e) {
      console.warn("[license] validation failed", e);
      // Keep cached; if no cache, treat as limited
      const cached = readCache();
      if (!cached) {
        setState((p) => ({ ...p, mode: "limited", checkedAt: Date.now() }));
      }
      appendLicenseDebugEntry({
        ts: Date.now(),
        event: "error",
        mode: cached?.mode ?? "limited",
        detail: e instanceof Error ? e.message : String(e),
        seatId: null,
        terminalId,
        fingerprintShort: deviceFingerprint.slice(0, 10),
        trigger,
      });
    }
  }, [user, restaurant?.id]);

  useEffect(() => {
    if (!user || !restaurant?.id) return;
    run("boot");
    const onOnline = () => run("online");
    window.addEventListener("online", onOnline);
    timerRef.current = window.setInterval(() => run("interval"), SIX_HOURS);
    return () => {
      window.removeEventListener("online", onOnline);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [run, user, restaurant?.id]);

  // Lightweight 5-minute presence heartbeat (no license re-validation) so the
  // Online badge reflects reality between the 6-hour validations above.
  useDevicePresencePing(!!user && !!restaurant?.id);

  const revokeDevice = useCallback(async (deviceId: string) => {
    const started = performance.now();
    const requestMeta = {
      functionName: "revoke-device-license",
      body: { device_id: deviceId },
      origin: typeof window !== "undefined" ? window.location.origin : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
    };
    try {
      const { data, error } = await db.functions.invoke("revoke-device-license", {
        body: { device_id: deviceId },
      });
      const durationMs = Math.round(performance.now() - started);
      const ctx = (error as unknown as { context?: { status?: number } } | null)?.context;
      const status = (ctx as { status?: number } | undefined)?.status;
      // Best-effort import; avoids adding to hook deps.
      void import("@/lib/offline/revokeDiagnosticsLog").then((m) =>
        m.appendRevokeDiagnostic({
          ts: Date.now(),
          deviceId,
          durationMs,
          ok: !error && !!(data as any)?.ok,
          request: requestMeta,
          response: {
            status,
            data,
            error: error
              ? {
                  name: (error as Error).name,
                  message: (error as Error).message,
                  context: ctx ?? null,
                }
              : null,
          },
        })
      );
      if (error) throw error;
      await run("manual");
      return { ok: !!(data as any)?.ok };
    } catch (e) {
      const durationMs = Math.round(performance.now() - started);
      void import("@/lib/offline/revokeDiagnosticsLog").then((m) =>
        m.appendRevokeDiagnostic({
          ts: Date.now(),
          deviceId,
          durationMs,
          ok: false,
          request: requestMeta,
          response: {
            error: {
              name: e instanceof Error ? e.name : "Error",
              message: e instanceof Error ? e.message : String(e),
              context: (e as { context?: unknown } | null)?.context ?? null,
            },
          },
        })
      );
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [run]);

  const value: LicenseContextValue = {
    ...state,
    isActive: state.mode === "active",
    isGrace: state.mode === "grace",
    isLimited: state.mode === "limited" || state.mode === "offline_stale",
    isLocked: state.mode === "locked",
    noSeat: state.mode === "no_seat",
    posWriteDisabled: state.mode === "limited" || state.mode === "locked" || state.mode === "no_seat" || state.mode === "offline_stale",
    refresh: () => run("manual"),
    revokeDevice,
  };

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within LicenseProvider");
  return ctx;
}