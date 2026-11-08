/**
 * Deep linking for notification actions.
 *
 * Goals:
 *  - Every notification action navigates with all required query params intact
 *    (branch, batch, expense, date, ...) — nothing is dropped on the way.
 *  - The destination URL is tagged with the originating notification so the user
 *    can be returned to the exact same notification context afterwards.
 *  - The context survives reloads and tab restores (localStorage + TTL).
 */

export const NOTIFICATION_CTX_PARAM = "notif";
export const NOTIFICATION_SOURCE_PARAM = "src";
export const NOTIFICATION_SOURCE_VALUE = "notification";
export const OPEN_NOTIFICATION_CENTER_EVENT = "matbex:open-notification-center";

const STORAGE_KEY = "matbex.notification.deeplink";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface NotificationDeepLinkContext {
  notificationId: string;
  title: string;
  message?: string | null;
  actionLabel: string;
  /** Full path (with query) the user was sent to. */
  targetPath: string;
  /** Path the user was on when the action was triggered. */
  originPath: string;
  /** Extra params the destination needs (branch, batch, expense, date...). */
  params: Record<string, string>;
  savedAt: number;
}

function isBrowser() {
  return typeof window !== "undefined";
}

/** Merge required params into an href without dropping the ones already there. */
export function withParams(href: string, params: Record<string, string | null | undefined>): string {
  const [pathPart, hashPart] = href.split("#");
  const [path, existing = ""] = pathPart.split("?");
  const search = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ""}${hashPart ? `#${hashPart}` : ""}`;
}

/** Read the query params carried by an href. */
export function paramsOf(href: string): Record<string, string> {
  const [pathPart] = href.split("#");
  const [, existing = ""] = pathPart.split("?");
  return Object.fromEntries(new URLSearchParams(existing).entries());
}

/**
 * Build the deep link for a notification action and persist the return context.
 * Returns the path to hand to `navigate()`.
 */
export function buildNotificationDeepLink(input: {
  href: string;
  notificationId: string;
  title: string;
  message?: string | null;
  actionLabel: string;
  originPath?: string;
}): string {
  const target = withParams(input.href, {
    [NOTIFICATION_CTX_PARAM]: input.notificationId,
    [NOTIFICATION_SOURCE_PARAM]: NOTIFICATION_SOURCE_VALUE,
  });

  saveNotificationContext({
    notificationId: input.notificationId,
    title: input.title,
    message: input.message ?? null,
    actionLabel: input.actionLabel,
    targetPath: target,
    originPath:
      input.originPath ??
      (isBrowser() ? `${window.location.pathname}${window.location.search}` : "/"),
    params: paramsOf(input.href),
    savedAt: Date.now(),
  });

  return target;
}

export function saveNotificationContext(ctx: NotificationDeepLinkContext) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* storage unavailable — deep link still works, just without the return banner */
  }
}

export function readNotificationContext(): NotificationDeepLinkContext | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotificationDeepLinkContext;
    if (!parsed?.notificationId) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > TTL_MS) {
      clearNotificationContext();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearNotificationContext() {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** The notification id carried by the current URL, if any. */
export function notificationIdFromSearch(search: string): string | null {
  try {
    return new URLSearchParams(search).get(NOTIFICATION_CTX_PARAM);
  } catch {
    return null;
  }
}

/** Ask the notification center to open (and focus a notification). */
export function openNotificationCenter(notificationId?: string) {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(OPEN_NOTIFICATION_CENTER_EVENT, { detail: { notificationId } })
  );
}
