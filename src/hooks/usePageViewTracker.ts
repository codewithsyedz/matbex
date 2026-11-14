import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { db } from "@/integrations/db/client";

/** Routes that belong to the signed-in product, not the public site. */
const PRIVATE_PREFIXES = ["/admin", "/dashboard", "/pos", "/kiosk", "/cfd"];

const SESSION_KEY = "mb_visit_session";

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/**
 * Records one row per public page view so the admin traffic page can show
 * where visitors land. No cookies, no personal data — just path, referrer,
 * language and a per-tab session id.
 */
export function usePageViewTracker() {
  const { pathname } = useLocation();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    if (last.current === pathname) return;
    last.current = pathname;

    const referrer = document.referrer || null;
    const isExternal =
      referrer && !referrer.startsWith(window.location.origin) ? referrer : null;

    void db
      .from("page_views")
      .insert({
        path: pathname,
        referrer: isExternal,
        language: document.documentElement.lang || navigator.language || null,
        device: window.innerWidth < 768 ? "mobile" : "desktop",
        session_id: getSessionId(),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [pathname]);
}
