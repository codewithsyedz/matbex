import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Keeps <head> consistent during client-side navigation.
 *
 * Problem: index.html ships static SEO tags (description, og:*, twitter:*).
 * react-helmet-async adds its own copies (marked `data-rh`) for routes that
 * render <Helmet>/<RouteSeo>, but it never removes the static ones — so
 * `document.querySelector('meta[name=description]')` (and crawlers/inspectors)
 * keep reading the stale index.html value until a full page refresh.
 *
 * Fix: whenever a Helmet-managed tag exists for a key, detach the static
 * duplicate; re-attach it when the route stops managing that key.
 */

const MANAGED_ATTRS: Array<{ tag: string; attr: "name" | "property" | "rel" }> = [
  { tag: "meta", attr: "name" },
  { tag: "meta", attr: "property" },
  { tag: "link", attr: "rel" },
];

const TRACKED = (key: string) =>
  key === "description" ||
  key === "canonical" ||
  key === "robots" ||
  key.startsWith("og:") ||
  key.startsWith("twitter:");

function collectStatic(): Map<string, Element[]> {
  const map = new Map<string, Element[]>();
  for (const { tag, attr } of MANAGED_ATTRS) {
    document.head.querySelectorAll(`${tag}[${attr}]`).forEach((el) => {
      if (el.hasAttribute("data-rh")) return;
      const key = el.getAttribute(attr) ?? "";
      if (!TRACKED(key)) return;
      const list = map.get(key) ?? [];
      list.push(el);
      map.set(key, list);
    });
  }
  return map;
}

export function HeadSync() {
  const location = useLocation();

  useEffect(() => {
    // Captured once on first run — these are the index.html fallbacks.
    const statics = (HeadSync as any)._statics ?? collectStatic();
    (HeadSync as any)._statics = statics;
    const defaultTitle: string = (HeadSync as any)._defaultTitle ?? document.title;
    (HeadSync as any)._defaultTitle = defaultTitle;

    let frame = 0;

    const sync = () => {
      frame = 0;
      const managedKeys = new Set<string>();
      for (const { tag, attr } of MANAGED_ATTRS) {
        document.head.querySelectorAll(`${tag}[${attr}][data-rh]`).forEach((el) => {
          managedKeys.add(el.getAttribute(attr) ?? "");
        });
      }

      statics.forEach((els: Element[], key: string) => {
        const helmetOwns = managedKeys.has(key);
        for (const el of els) {
          const attached = el.parentNode === document.head;
          if (helmetOwns && attached) {
            document.head.removeChild(el);
          } else if (!helmetOwns && !attached) {
            document.head.appendChild(el);
          }
        }
      });

      // Routes without their own <Helmet> should fall back to the site title
      // instead of keeping the previous route's title.
      // Helmet manages <title> via document.title (no data-rh marker), so use
      // the presence of any Helmet-managed tag as the signal that this route
      // owns the head.
      const routeOwnsHead =
        managedKeys.size > 0 || !!document.head.querySelector("[data-rh]");
      if (!routeOwnsHead && document.title !== defaultTitle) {
        document.title = defaultTitle;
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(sync);
    };

    schedule();

    const observer = new MutationObserver(schedule);
    observer.observe(document.head, { childList: true, attributes: true, subtree: false });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  return null;
}