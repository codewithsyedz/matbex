export function readSessionHydration<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export function writeSessionHydration<T>(key: string, value: T | null) {
  if (typeof window === "undefined") return;

  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
      return;
    }

    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures so auth flow stays resilient.
  }
}