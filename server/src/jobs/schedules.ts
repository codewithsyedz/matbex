/**
 * Default schedules for scheduler-driven server functions.
 *
 * The hosted project ran these from dashboard-created pg_cron jobs, which
 * were never in the repo. If you import production's cron.job rows, those
 * take precedence (a function already triggered by a cron.job row is skipped
 * here). Otherwise these defaults apply. Override or disable any entry with
 * JOB_SCHEDULES_JSON, e.g. {"send-weekly-digest":"0 8 * * 1","auto-shift-manager":null}
 *
 * Expressions are evaluated in JOBS_TIMEZONE (default Asia/Riyadh).
 */
export const JOBS_TIMEZONE = process.env.JOBS_TIMEZONE ?? "Asia/Riyadh";

export const DEFAULT_FUNCTION_SCHEDULES: Record<string, string | null> = {
  "auto-shift-manager": "*/15 * * * *",
  "payments-reconciler": "*/15 * * * *",
  "zatca-device-monitor": "*/30 * * * *",
  "send-scheduled-reports": "0 * * * *",
  "run-cogs-trueup-schedules": "30 2 * * *",
  "nightly-invoice-ledger-scan": "0 3 * * *",
  // Account balances vs the ledger (corrections logged), journal entry numbering, integrity report.
  "ledger-balance-check": "15 * * * *",
  "zatca-chain-integrity-check": "0 4 * * *",
  "send-expiry-alerts": "0 8 * * *",
  "send-salary-reminder": "0 9 * * *",
  "cogs-submission-reminder": "0 10 * * *",
  "bnpl-overdue-reminders": "0 10 * * *",
  "send-daily-profit-summary": "0 23 * * *",
  "send-daily-whatsapp-summary": "5 23 * * *",
  "send-weekly-digest": "0 9 * * 0",
  // Subscription quantity = active branches (report-only unless BRANCH_BILLING_ENABLED=true).
  "sync-branch-billing": "20 * * * *",
  // Same check the accountant dashboard runs on refresh; unchanged backlogs are not re-sent.
  "accountant-pending-alerts": "0 9 * * *",
  // Moyasar-billed subscriptions: renewal reminders (7/3/1 days) and past due after the paid-until date.
  "subscription-renewals": "0 9 * * *",
  // Trial setup emails on trial days 1, 7 and 12 (owners of businesses still on trial).
  "trial-nurture": "0 10 * * *",
  // Order status changes to Deliverect (delivery_status_outbox), retried until accepted.
  "deliverect-status-sync": "* * * * *",
  // Present but not scheduled by default — enable via JOB_SCHEDULES_JSON if you used them:
  "process-posting-job": null,
  "process-export-requests": null,
  "zatca-clearance-worker": null,
  "send-webhook-notifications": null,
  "send-loyalty-reengagement": null,
  "poll-domain-ssl": null,
  "get-exchange-rates": null,
};
