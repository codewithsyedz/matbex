export type TourStep = {
  id: string;
  /** Docs anchor at /docs#<anchor> */
  anchor: string;
  title: string;
  description: string;
  /** In-app route this step refers to (where the user actually does the thing) */
  route: string;
  cta: string;
  group: "Setup" | "Daily Operations" | "Reference" | "Security" | "Integrations";
};

export const TOUR_STEPS: TourStep[] = [
  // Setup
  {
    id: "installation",
    anchor: "installation",
    title: "Install Matbex POS",
    description: "Download and install the Matbex POS APK on your tablet from Devices.",
    route: "/devices",
    cta: "Open Devices",
    group: "Setup",
  },
  {
    id: "configuration",
    anchor: "configuration",
    title: "Configure your restaurant",
    description: "Set fiscal cycle, timezone, currency and tax rates in Settings.",
    route: "/settings",
    cta: "Open Settings",
    group: "Setup",
  },
  {
    id: "first-steps",
    anchor: "first-steps",
    title: "First steps",
    description: "Invite your team, create your first menu item, then open a shift.",
    route: "/staff",
    cta: "Open Team",
    group: "Setup",
  },

  // Daily Operations
  {
    id: "dashboard",
    anchor: "dashboard",
    title: "Owner Dashboard",
    description: "Track sales, profit and KPI alerts at a glance.",
    route: "/dashboard",
    cta: "Open Dashboard",
    group: "Daily Operations",
  },
  {
    id: "sales-management",
    anchor: "sales-management",
    title: "Record sales & manage shifts",
    description: "Open a shift, record sales, then close with reconciliation.",
    route: "/shifts",
    cta: "Open Shifts",
    group: "Daily Operations",
  },
  {
    id: "inventory-control",
    anchor: "inventory-control",
    title: "Inventory & COGS",
    description: "Log purchases, run stocktakes, and let the system compute COGS.",
    route: "/inventory",
    cta: "Open Inventory",
    group: "Daily Operations",
  },

  // Reference (read in docs)
  {
    id: "authentication",
    anchor: "authentication",
    title: "API authentication",
    description: "How to authenticate against the Matbex Terminal API.",
    route: "/docs#authentication",
    cta: "Read in Docs",
    group: "Reference",
  },
  {
    id: "endpoints",
    anchor: "endpoints",
    title: "API endpoints",
    description: "Browse the full REST surface for the terminal API.",
    route: "/api",
    cta: "Open API Reference",
    group: "Reference",
  },
  {
    id: "webhooks",
    anchor: "webhooks",
    title: "Webhooks",
    description: "Subscribe to events like sale.completed and shift.closed.",
    route: "/docs#webhooks",
    cta: "Read in Docs",
    group: "Reference",
  },
  {
    id: "data-import",
    anchor: "data-import",
    title: "Data import",
    description: "Bulk-import menu, inventory and historical expenses via CSV.",
    route: "/migration",
    cta: "Open Import",
    group: "Reference",
  },
  {
    id: "backups",
    anchor: "backups",
    title: "Backups & exports",
    description: "Export P&L, sales, and ledger archives for accounting.",
    route: "/accounting",
    cta: "Open Accounting",
    group: "Reference",
  },
  {
    id: "reports",
    anchor: "reports",
    title: "Reports",
    description: "Run Trial Balance, P&L and finance reports.",
    route: "/trial-balance",
    cta: "Open Reports",
    group: "Reference",
  },

  // Security
  {
    id: "mfa-setup",
    anchor: "mfa-setup",
    title: "Enable MFA",
    description: "Add multi-factor auth for owners and managers.",
    route: "/settings",
    cta: "Open Settings",
    group: "Security",
  },
  {
    id: "access-control",
    anchor: "access-control",
    title: "Access control",
    description: "Assign roles: owner, manager, accountant, cashier.",
    route: "/staff",
    cta: "Open Team",
    group: "Security",
  },
  {
    id: "audit-logs",
    anchor: "audit-logs",
    title: "Audit logs",
    description: "Review every privileged action across your tenant.",
    route: "/audit-logs",
    cta: "Open Audit Logs",
    group: "Security",
  },

  // Integrations
  {
    id: "pos-systems",
    anchor: "pos-systems",
    title: "POS terminals",
    description: "Pair tablets, manage devices, sync offline orders.",
    route: "/pos-terminals",
    cta: "Open POS Terminals",
    group: "Integrations",
  },
  {
    id: "accounting",
    anchor: "accounting",
    title: "Accounting integrations",
    description: "Connect Zoho Books and other accounting providers.",
    route: "/accounting",
    cta: "Open Accounting",
    group: "Integrations",
  },
  {
    id: "delivery-platforms",
    anchor: "delivery-platforms",
    title: "Delivery platforms",
    description: "Route delivery orders into your sales and inventory flow.",
    route: "/sales",
    cta: "Open Sales",
    group: "Integrations",
  },
];