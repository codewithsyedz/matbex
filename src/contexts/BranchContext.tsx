import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useIsFetching } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { AuthContext } from "@/contexts/AuthContext";

/**
 * Radix UI (Popover/Dialog/Dropdown) occasionally leaves
 * `pointer-events: none` on <body> when it closes while React is busy
 * (e.g. switching branches triggers a flurry of refetches). The result
 * is a completely unresponsive UI until the user hard-refreshes.
 * Force-clear the body lock on every branch switch.
 */
function releaseBodyPointerLock() {
  if (typeof document === "undefined") return;
  // Radix can re-apply `pointer-events: none` on <body> several times
  // while the Popover unmounts and React commits the branch swap. A
  // single delayed clear races with Radix's own cleanup, leaving the
  // page unclickable. Poll for ~1s and clear every time it reappears.
  const clear = () => {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    document.body.removeAttribute("data-scroll-locked");
  };
  clear();
  const delays = [0, 50, 120, 250, 500, 1000];
  delays.forEach((d) => setTimeout(clear, d));
}

export interface Branch {
  id: string;
  restaurant_id: string;
  name: string;
  code: string | null;
  is_primary: boolean;
  is_active: boolean;
  country?: string | null;
  city?: string | null;
}

interface BranchContextValue {
  branches: Branch[];
  activeBranch: Branch | null;
  activeBranchId: string | null;
  setActiveBranchId: (id: string | "all") => void;
  /** True when the user picked "All branches" (owners/managers only). */
  isAllBranches: boolean;
  isLoading: boolean;
  /**
   * True once the persisted branch selection has been restored (or a
   * default has been resolved). Data hooks should gate their queries on
   * this so they never fire a tenant-wide query with `activeBranchId ===
   * null` and then re-fire under the real branch a tick later.
   */
  isBranchReady: boolean;
  /** Whether the tenant has more than one branch (drives UI affordances). */
  hasMultipleBranches: boolean;
  /**
   * True briefly after the active branch changes, while downstream queries
   * refetch. Consumers can render a lightweight skeleton instead of letting
   * every page paint stale data + spinners simultaneously.
   */
  isSwitchingBranch: boolean;
  /**
   * If the current user has been pinned to a specific branch (via
   * `staff.assigned_branch_id`) and is not an owner/manager, this holds
   * that branch id. UI uses it to lock the BranchSwitcher.
   */
  pinnedBranchId: string | null;
  /** False when the user is pinned to a single branch. */
  canSwitchBranches: boolean;
}

const BranchContext = createContext<BranchContextValue | undefined>(undefined);

const storageKey = (tenantId: string | null | undefined) =>
  tenantId ? `matbex.activeBranch.${tenantId}` : null;

/** Query-string param that mirrors the active branch (`?branch=<id|all>`). */
const BRANCH_PARAM = "branch";

/**
 * On native (Android POS tablets) localStorage inside the WebView can be
 * evicted by the system. Mirror the selection into Capacitor Preferences so
 * the branch context survives app restarts and WebView storage clears.
 */
const nativePrefs = async () => {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  const { Preferences } = await import("@capacitor/preferences");
  return Preferences;
};

const persistBranchSelection = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable in private modes */
  }
  void nativePrefs()
    .then((p) => p?.set({ key, value }))
    .catch(() => undefined);
};

const clearBranchSelection = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
  void nativePrefs()
    .then((p) => p?.remove({ key }))
    .catch(() => undefined);
};

export function BranchProvider({ children }: { children: ReactNode }) {
  // Read AuthContext defensively. If the provider hasn't mounted yet (e.g.
  // an HMR race or a transient error boundary remount), fall back to empty
  // values instead of throwing — BranchProvider will re-render once
  // AuthProvider is available.
  const auth = useContext(AuthContext) as any;
  const user = auth?.user ?? null;
  const tenant = auth?.tenant ?? null;
  const restaurant = auth?.restaurant ?? null;
  const hasRole = (auth?.hasRole ?? (() => false)) as (r: string) => boolean;
  const tenantId = tenant?.id ?? null;
  const restaurantId = restaurant?.id ?? null;
  // Owners, managers and accountants are all "all-branch" roles: they are
  // never pinned to a single branch and can switch freely. Mirrors the
  // server-side rule in `user_can_access_branch`.
  const isManager =
    hasRole("owner") || hasRole("manager") || hasRole("accountant");

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as Branch[];
      const { data, error } = await db
        .from("branches" as any)
        .select("id, restaurant_id, name, code, is_primary, is_active, country, city")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("is_primary", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Branch[];
    },
    enabled: !!restaurantId,
  });

  // Pinned branch for branch-scoped users (cashiers, waiters, etc.)
  const { data: pinnedBranchId = null } = useQuery({
    queryKey: ["staff-pinned-branch", user?.id, restaurantId],
    queryFn: async () => {
      if (!user?.id || !restaurantId) return null;
      const { data, error } = await db
        .from("staff")
        .select("assigned_branch_id")
        .eq("user_id", user.id)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .not("assigned_branch_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data?.assigned_branch_id as string | null) ?? null;
    },
    enabled: !!user?.id && !!restaurantId && !isManager,
    staleTime: 5 * 60 * 1000,
  });

  const effectivePinnedBranchId = isManager ? null : pinnedBranchId;
  const canSwitchBranches = isManager || !effectivePinnedBranchId;

  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);
  // Flipped once the stored selection (or a computed default) has been
  // applied for the current tenant. Reset whenever the tenant changes.
  const [isHydrated, setIsHydrated] = useState(false);
  // Blocks hydration until the native Preferences mirror has been read back
  // into localStorage, so we never default to the primary branch first and
  // flip afterwards.
  const [storageReady, setStorageReady] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const switchTimerRef = useRef<number | null>(null);
  const switchStartedAtRef = useRef<number>(0);
  const isFetching = useIsFetching();

  // `?branch=<id|all>` keeps the selection shareable and survives reloads
  // even when storage is unavailable (private mode, kiosk WebViews).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlBranch = searchParams.get(BRANCH_PARAM);

  const clearSwitchTimer = () => {
    if (switchTimerRef.current !== null) {
      window.clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  };

  const beginSwitch = () => {
    setIsSwitchingBranch(true);
    switchStartedAtRef.current = Date.now();
    clearSwitchTimer();
    // Hard cap so the skeleton can never get stuck on, even if a query
    // never resolves.
    switchTimerRef.current = window.setTimeout(() => {
      setIsSwitchingBranch(false);
      switchTimerRef.current = null;
    }, 4000);
  };

  // Release the skeleton once outstanding queries settle, but keep it up
  // for at least 250ms so the user always sees the transition.
  useEffect(() => {
    if (!isSwitchingBranch) return;
    if (isFetching > 0) return;
    const elapsed = Date.now() - switchStartedAtRef.current;
    const remaining = Math.max(0, 250 - elapsed);
    const t = window.setTimeout(() => {
      setIsSwitchingBranch(false);
      clearSwitchTimer();
      // Final safety net - Radix may have re-locked the body during the
      // refetch storm. Clear it again once the skeleton retires.
      releaseBodyPointerLock();
    }, remaining);
    return () => window.clearTimeout(t);
  }, [isSwitchingBranch, isFetching]);

  useEffect(() => {
    return () => {
      clearSwitchTimer();
    };
  }, []);

  // Restore the native-persisted selection into localStorage before hydrating.
  useEffect(() => {
    let cancelled = false;
    const key = storageKey(tenantId);
    if (!key) return;
    setStorageReady(false);
    setIsHydrated(false);
    (async () => {
      try {
        const prefs = await nativePrefs();
        if (prefs && !localStorage.getItem(key)) {
          const { value } = await prefs.get({ key });
          if (value) localStorage.setItem(key, value);
        }
      } catch {
        /* fall back to whatever localStorage holds */
      }
      if (!cancelled) setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Hydrate from localStorage / pick primary as default.
  useEffect(() => {
    if (!tenantId || branches.length === 0) return;
    if (!storageReady) return;
    // Pinned users: force their branch, ignore stored selection.
    if (effectivePinnedBranchId) {
      const match = branches.find((b) => b.id === effectivePinnedBranchId);
      if (match) {
        setActiveBranchIdState(match.id);
        // Wipe any stored selection so a later session can't restore it.
        const key = storageKey(tenantId);
        if (key) clearBranchSelection(key);
        setIsHydrated(true);
        return;
      }
    }
    const key = storageKey(tenantId);
    // URL wins over storage so deep links / shared URLs open on the right
    // branch, then it is written back to storage as the new default.
    let stored: string | null = null;
    try {
      stored = key ? localStorage.getItem(key) : null;
    } catch {
      stored = null;
    }
    if (urlBranch) stored = urlBranch;
    if (stored === "all" && (hasRole("owner") || hasRole("manager") || hasRole("accountant"))) {
      setActiveBranchIdState("__all__");
      if (key) persistBranchSelection(key, "all");
      setIsHydrated(true);
      return;
    }
    const match = stored && branches.find((b) => b.id === stored && b.is_active !== false);
    if (match) {
      setActiveBranchIdState(match.id);
      if (key) persistBranchSelection(key, match.id);
      setIsHydrated(true);
      return;
    }
    const primary = branches.find((b) => b.is_primary && b.is_active !== false) ?? branches[0];
    setActiveBranchIdState(primary?.id ?? null);
    // The stored value was missing, deleted or now inactive - rewrite it so
    // the next refresh restores exactly what the user is looking at.
    if (key && primary?.id) persistBranchSelection(key, primary.id);
    setIsHydrated(true);
  }, [tenantId, branches, hasRole, effectivePinnedBranchId, storageReady, urlBranch]);

  // Mirror the active branch into the URL (replace, so it never pollutes
  // browser history) once hydration settled.
  useEffect(() => {
    if (!isHydrated || !activeBranchId) return;
    const logical = activeBranchId === "__all__" ? "all" : activeBranchId;
    if (searchParams.get(BRANCH_PARAM) === logical) return;
    const next = new URLSearchParams(searchParams);
    next.set(BRANCH_PARAM, logical);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId, isHydrated, searchParams]);

  // Keep multiple tabs / windows on the same branch. Pinned users are
  // handled by the hard-lock effect below.
  // Tenants without any branch row never reach the hydration effect above;
  // mark them ready so branch-gated queries are not blocked forever.
  useEffect(() => {
    if (isLoading) return;
    if (branches.length === 0) setIsHydrated(true);
  }, [isLoading, branches.length]);

  useEffect(() => {
    if (!tenantId || effectivePinnedBranchId) return;
    const key = storageKey(tenantId);
    if (!key) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      const next = e.newValue === "all" ? "__all__" : e.newValue;
      if (next === "__all__" && !canSwitchBranches) return;
      if (next !== "__all__" && !branches.some((b) => b.id === next)) return;
      setActiveBranchIdState((cur) => (cur === next ? cur : next));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tenantId, effectivePinnedBranchId, branches, canSwitchBranches]);

  // Hard lock: whenever the active branch drifts away from the pinned
  // branch (devtools tampering, stale state from an HMR remount, a stray
  // setActiveBranchId call from legacy code, etc.), snap it back.
  useEffect(() => {
    if (!effectivePinnedBranchId) return;
    if (activeBranchId !== effectivePinnedBranchId) {
      setActiveBranchIdState(effectivePinnedBranchId);
    }
  }, [activeBranchId, effectivePinnedBranchId]);

  // Also clear any cross-tab localStorage writes that try to flip the
  // pinned user onto another branch.
  useEffect(() => {
    if (!effectivePinnedBranchId || !tenantId) return;
    const key = storageKey(tenantId);
    if (!key) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue && e.newValue !== effectivePinnedBranchId) {
        clearBranchSelection(key);
        setActiveBranchIdState(effectivePinnedBranchId);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [effectivePinnedBranchId, tenantId]);

  const setActiveBranchId = (id: string | "all") => {
    // Block pinned users from switching away from their assigned branch.
    if (effectivePinnedBranchId && id !== effectivePinnedBranchId) {
      // Make sure no stale localStorage entry survives the attempt.
      const key = storageKey(tenantId);
      if (key) clearBranchSelection(key);
      return;
    }
    const key = storageKey(tenantId);
    const currentLogical = activeBranchId === "__all__" ? "all" : activeBranchId;
    const nextLogical = id;
    const changed = currentLogical !== null && currentLogical !== nextLogical;
    const nextState = id === "all" ? "__all__" : id;

    if (key) persistBranchSelection(key, id);
    releaseBodyPointerLock();

    if (!changed) {
      setActiveBranchIdState(nextState);
      return;
    }

    // 1. Paint the skeleton first (synchronous, urgent update).
    // 2. Defer the branch-id swap to the next frame so the skeleton
    //    actually reaches the screen before the heavy refetch / unmount
    //    storm begins. Without this, React batches both updates and the
    //    main thread is blocked before the overlay paints - the user
    //    sees a frozen page instead of a skeleton.
    beginSwitch();
    requestAnimationFrame(() => {
      setActiveBranchIdState(nextState);
    });
  };

  const value = useMemo<BranchContextValue>(() => {
    const isAll = activeBranchId === "__all__";
    const activeBranch =
      !isAll && activeBranchId
        ? branches.find((b) => b.id === activeBranchId) ?? null
        : null;
    return {
      branches,
      activeBranch,
      activeBranchId: isAll ? null : activeBranchId,
      setActiveBranchId,
      isAllBranches: isAll,
      isLoading,
      isBranchReady: isHydrated,
      hasMultipleBranches: branches.length > 1,
      isSwitchingBranch,
      pinnedBranchId: effectivePinnedBranchId,
      canSwitchBranches,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, activeBranchId, isLoading, isHydrated, isSwitchingBranch, effectivePinnedBranchId, canSwitchBranches]);

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}

/** Branch context, or null outside <BranchProvider> (for hooks also used on public pages). */
export function useOptionalBranch() {
  return useContext(BranchContext) ?? null;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error("useBranch must be used inside <BranchProvider>");
  }
  return ctx;
}