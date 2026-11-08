import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

function storageKey(userId: string | null | undefined) {
  return `matbex.onboarding.progress.${userId ?? "anon"}`;
}

function dismissedKey(userId: string | null | undefined) {
  return `matbex.onboarding.launcher.${userId ?? "anon"}`;
}

export function useOnboardingProgress() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(uid));
      setCompleted(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setCompleted(new Set());
    }
  }, [uid]);

  const persist = useCallback(
    (next: Set<string>) => {
      setCompleted(new Set(next));
      try {
        localStorage.setItem(storageKey(uid), JSON.stringify(Array.from(next)));
      } catch {
        // ignore quota errors
      }
    },
    [uid],
  );

  const toggle = useCallback(
    (id: string, value?: boolean) => {
      const next = new Set(completed);
      const target = value ?? !next.has(id);
      if (target) next.add(id);
      else next.delete(id);
      persist(next);
    },
    [completed, persist],
  );

  const reset = useCallback(() => persist(new Set()), [persist]);

  return { completed, toggle, reset, total: completed.size };
}

export function useOnboardingLauncherDismissed() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(dismissedKey(uid)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [uid]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(uid), "1");
    } catch {
      // ignore
    }
  }, [uid]);

  return { dismissed, dismiss };
}