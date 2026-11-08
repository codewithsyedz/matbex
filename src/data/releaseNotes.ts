export type ReleaseImpact = "backend-only" | "terminal-update" | "web-app";

export interface ReleaseNoteItem {
  title: string;
  description: string;
  impact: ReleaseImpact;
  area?: string;
}

export interface ReleaseNote {
  version: string;
  date: string; // YYYY-MM-DD
  summary: string;
  items: ReleaseNoteItem[];
}

export const IMPACT_META: Record<ReleaseImpact, { label: string; hint: string }> = {
  "backend-only": {
    label: "Backend only",
    hint: "Applies automatically. No Android terminal update needed.",
  },
  "terminal-update": {
    label: "Terminal update required",
    hint: "Android terminals must be updated / re-paired to get this change.",
  },
  "web-app": {
    label: "Web app only",
    hint: "Dashboard change. Terminals are unaffected.",
  },
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026.08.14",
    date: "2026-08-14",
    summary: "Sale-to-ledger posting monitoring and terminal recovery tooling.",
    items: [
      {
        title: "Sale posting failure monitoring & alerts",
        description:
          "Failed sale-to-ledger postings are logged with branch, shift and error code, and notify owners, managers and accountants in-app.",
        impact: "backend-only",
        area: "Accounting",
      },
      {
        title: "Sale Posting Monitor page",
        description:
          "New page under Sales showing unresolved failures, unposted closed days, idempotency replay counts and CSV export.",
        impact: "web-app",
        area: "Reports",
      },
      {
        title: "Idempotency replay counters in pos-sync",
        description:
          "pos-sync now records replay counts when a terminal re-sends an existing key. Wire contract unchanged.",
        impact: "backend-only",
        area: "POS Sync",
      },
      {
        title: "Refresh terminal state action",
        description:
          "Admins can bump menu/price versions so terminals pull fresh state without closing a shift. Terminals pick this up on their next heartbeat.",
        impact: "backend-only",
        area: "Terminals",
      },
    ],
  },
  {
    version: "2026.08.10",
    date: "2026-08-10",
    summary: "POS sync reliability and diagnostics.",
    items: [
      {
        title: "CORS scope fix in pos-sync and terminal-api",
        description:
          "Fixed a request-scoped header bug that caused dropped terminal batches. Queued sales replay automatically.",
        impact: "backend-only",
        area: "POS Sync",
      },
      {
        title: "Dead-letter queue with reprocess controls",
        description: "Admin DLQ with batch grouping, bulk reprocess and full request/response traces.",
        impact: "web-app",
        area: "Admin",
      },
      {
        title: "POS ack diagnostics",
        description:
          "Per branch and date view of idempotency keys that failed to ack, linked to sales and ledger records.",
        impact: "backend-only",
        area: "POS Sync",
      },
    ],
  },
  {
    version: "2026.07.28",
    date: "2026-07-28",
    summary: "Kiosk-mode terminals and branch pinning.",
    items: [
      {
        title: "Android kiosk mode, splash screen and icons",
        description:
          "Full-screen locked POS mode with Matbex branding. Requires installing the updated Android build on each terminal.",
        impact: "terminal-update",
        area: "Android App",
      },
      {
        title: "Terminal branch re-pinning",
        description:
          "Settings screen to re-pin a terminal to a branch and view pairing status. Terminals on older builds must be updated to honour re-pinning.",
        impact: "terminal-update",
        area: "Terminals",
      },
      {
        title: "Per-branch VAT rate",
        description: "VAT rate is configured per branch and applied server-side at posting time.",
        impact: "backend-only",
        area: "VAT",
      },
    ],
  },
];
