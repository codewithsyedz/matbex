export const PENDING_ZATCA_STATUSES = ["submitted", "under_review"] as const;

/** Days since the application last changed status, or null when it isn't waiting on ZATCA. */
export function zatcaReminderDue(
  app: { status: string; status_changed_at?: string | null; submitted_at?: string | null; reminder_days?: number | null },
  now: Date = new Date(),
): { due: boolean; daysWaiting: number } | null {
  if (!(PENDING_ZATCA_STATUSES as readonly string[]).includes(app.status)) return null;
  const since = app.status_changed_at ?? app.submitted_at;
  if (!since) return null;
  const daysWaiting = Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000);
  return { due: daysWaiting >= (app.reminder_days ?? 14), daysWaiting };
}
