import { useEffect, useState, useCallback, useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { useSearchParams } from "react-router-dom";
import type { DateRangePreset } from "@/components/filters/BranchDateRangeFilter";
import { useBranch } from "@/contexts/BranchContext";

interface PersistedFilterState {
  branchId: string | "all" | "untagged" | null;
  preset: DateRangePreset;
  customRange?: DateRange;
}

export type BranchFilterValue = PersistedFilterState["branchId"];

const VALID_PRESETS: DateRangePreset[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "this-month",
  "last-month",
  "custom",
];

function storageKey(page: string, tenantId: string | null | undefined, key: string) {
  if (!tenantId) return null;
  return `matbex.${page}.filter.${tenantId}.${key}`;
}

function readItem<T>(key: string | null, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeItem<T>(key: string | null, value: T) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota exceeded - silently ignore.
  }
}

function parseDateParam(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toISODateOnly(d: Date): string {
  // YYYY-MM-DD keeps URLs short and shareable across timezones for date filters.
  return d.toISOString().slice(0, 10);
}

/**
 * Persists branch + date range filter state in the URL query string
 * (source of truth - makes filtered views bookmarkable and shareable) with
 * localStorage as a fallback when the URL has no params.
 *
 * URL params: `?branch=<id|all>&range=<preset>&from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Pinned staff have their branch forced to `pinnedBranchId` regardless of
 * what the URL says - date prefs still apply.
 */
export function usePersistedBranchDateFilter(
  page: "shifts" | "finance" | "trial-balance" | "vat-audit" | "cash-flow",
  tenantId: string | null | undefined,
  defaults: PersistedFilterState,
) {
  const { pinnedBranchId, canSwitchBranches, activeBranchId: globalActiveBranchId, isAllBranches } =
    useBranch();
  const [searchParams, setSearchParams] = useSearchParams();

  const branchKey = storageKey(page, tenantId, "branchId");
  const presetKey = storageKey(page, tenantId, "preset");
  const rangeKey = storageKey(page, tenantId, "customRange");

  // ---- Initial resolution: URL → localStorage → defaults --------------------
  const initial = useMemo(() => {
    const urlBranch = searchParams.get("branch");
    const urlPreset = searchParams.get("range") as DateRangePreset | null;
    const urlFrom = parseDateParam(searchParams.get("from"));
    const urlTo = parseDateParam(searchParams.get("to"));

    const branchId: BranchFilterValue =
      urlBranch !== null
        ? urlBranch === "all"
          ? "all"
          : urlBranch === "untagged"
            ? "untagged"
            : urlBranch
        : readItem<BranchFilterValue>(branchKey, defaults.branchId);

    const preset =
      urlPreset && VALID_PRESETS.includes(urlPreset)
        ? urlPreset
        : readItem<DateRangePreset>(presetKey, defaults.preset);

    const customRange: DateRange | undefined =
      urlFrom || urlTo
        ? { from: urlFrom, to: urlTo }
        : readItem<DateRange | undefined>(rangeKey, defaults.customRange);

    return { branchId, preset, customRange };
    // Resolve only on mount; subsequent updates flow via setters below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [branchId, setBranchIdState] = useState<BranchFilterValue>(() => {
    if (!canSwitchBranches && pinnedBranchId) return pinnedBranchId;
    return initial.branchId;
  });
  const [preset, setPresetState] = useState<DateRangePreset>(initial.preset);
  const [customRange, setCustomRangeState] = useState<DateRange | undefined>(
    initial.customRange,
  );

  // ---- URL writer (merges with any unrelated existing params) ----------------
  const writeUrl = useCallback(
    (next: { branchId?: BranchFilterValue; preset?: DateRangePreset; customRange?: DateRange | undefined }) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);

          if (next.branchId !== undefined) {
            if (next.branchId === null) params.delete("branch");
            else params.set("branch", next.branchId);
          }
          if (next.preset !== undefined) {
            params.set("range", next.preset);
            if (next.preset !== "custom") {
              params.delete("from");
              params.delete("to");
            }
          }
          if (next.customRange !== undefined) {
            if (next.customRange?.from) params.set("from", toISODateOnly(next.customRange.from));
            else params.delete("from");
            if (next.customRange?.to) params.set("to", toISODateOnly(next.customRange.to));
            else params.delete("to");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // If user becomes pinned while page is open (edge case), force the branch.
  useEffect(() => {
    if (!canSwitchBranches && pinnedBranchId && branchId !== pinnedBranchId) {
      setBranchIdState(pinnedBranchId);
      writeUrl({ branchId: pinnedBranchId });
    }
  }, [canSwitchBranches, pinnedBranchId, branchId, writeUrl]);

  // Mirror the global top BranchSwitcher into this page's filter so changing
  // branches in the header propagates to pages that own their own filter
  // state (Shifts / Finance / Trial Balance). Without this, navigating to
  // one of these pages restores its last *local* selection and the header
  // change appears to be reverted. "untagged" is a page-local filter and is
  // preserved when the global branch changes.
  useEffect(() => {
    if (!canSwitchBranches) return; // pinned users handled above
    if (branchId === "untagged") return; // preserve the untagged view
    const nextGlobal: string | "all" | null = isAllBranches
      ? "all"
      : globalActiveBranchId ?? null;
    if (nextGlobal === null) return;
    if (nextGlobal === branchId) return;
    setBranchIdState(nextGlobal);
    writeItem(branchKey, nextGlobal);
    writeUrl({ branchId: nextGlobal });
  }, [globalActiveBranchId, isAllBranches, canSwitchBranches, branchId, branchKey, writeUrl]);

  // Sync initial state into URL once on mount so the URL always reflects
  // the active filter - that's what makes it shareable.
  useEffect(() => {
    const patch: Parameters<typeof writeUrl>[0] = {};
    if (searchParams.get("branch") === null && branchId !== null) patch.branchId = branchId;
    if (searchParams.get("range") === null) patch.preset = preset;
    if (preset === "custom" && customRange && !searchParams.get("from") && !searchParams.get("to")) {
      patch.customRange = customRange;
    }
    if (Object.keys(patch).length > 0) writeUrl(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBranchId = useCallback(
    (next: string | "all" | "untagged") => {
      if (!canSwitchBranches) return; // pinned - no-op
      setBranchIdState(next);
      writeItem(branchKey, next);
      writeUrl({ branchId: next });
    },
    [branchKey, canSwitchBranches, writeUrl],
  );

  const setPreset = useCallback(
    (next: DateRangePreset) => {
      setPresetState(next);
      writeItem(presetKey, next);
      writeUrl({ preset: next });
    },
    [presetKey, writeUrl],
  );

  const setCustomRange = useCallback(
    (next: DateRange | undefined) => {
      setCustomRangeState(next);
      writeItem(rangeKey, next);
      writeUrl({ customRange: next });
    },
    [rangeKey, writeUrl],
  );

  return {
    branchId,
    setBranchId,
    preset,
    setPreset,
    customRange,
    setCustomRange,
  };
}