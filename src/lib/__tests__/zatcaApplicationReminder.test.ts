import { describe, expect, it } from "vitest";
import { zatcaReminderDue } from "../zatcaApplicationReminder";

const now = new Date("2026-11-20T00:00:00Z");

describe("zatcaReminderDue", () => {
  it("is due once a submitted application has waited the reminder days", () => {
    expect(zatcaReminderDue({ status: "submitted", status_changed_at: "2026-11-06T00:00:00Z", reminder_days: 14 }, now)).toEqual({ due: true, daysWaiting: 14 });
  });
  it("is not due before the reminder days", () => {
    expect(zatcaReminderDue({ status: "under_review", status_changed_at: "2026-11-10T00:00:00Z", reminder_days: 14 }, now)?.due).toBe(false);
  });
  it("never reminds for approved or rejected applications", () => {
    expect(zatcaReminderDue({ status: "approved", status_changed_at: "2026-01-01T00:00:00Z" }, now)).toBeNull();
    expect(zatcaReminderDue({ status: "rejected", status_changed_at: "2026-01-01T00:00:00Z" }, now)).toBeNull();
  });
});
