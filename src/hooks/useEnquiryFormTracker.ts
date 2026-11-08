import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export type EnquiryFormEvent = "view" | "start" | "submit" | "error";

/**
 * Counts how many visitors see the enquiry form, start filling it in and
 * actually send it. No cookies, no personal data — just the step, the page
 * and a per-tab session id.
 */
export function useEnquiryFormTracker(formRef: React.RefObject<HTMLElement>) {
  const sent = useRef<Set<EnquiryFormEvent>>(new Set());

  const track = useCallback((event: EnquiryFormEvent, once = true) => {
    if (typeof window === "undefined") return;
    if (once) {
      if (sent.current.has(event)) return;
      sent.current.add(event);
    }
    const referrer = document.referrer || null;
    const isExternal =
      referrer && !referrer.startsWith(window.location.origin) ? referrer : null;

    void supabase
      .from("enquiry_form_events")
      .insert({
        event,
        path: window.location.pathname,
        referrer: isExternal,
        language: document.documentElement.lang || navigator.language || null,
        device: window.innerWidth < 768 ? "mobile" : "desktop",
        session_id: getSessionId(),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }, []);

  // Fire "view" the first time the form scrolls into sight.
  useEffect(() => {
    const el = formRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          track("view");
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [formRef, track]);

  return track;
}
