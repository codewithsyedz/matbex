DO $$
DECLARE
  v_page_id uuid;
BEGIN
  SELECT id INTO v_page_id FROM public.cms_pages WHERE slug = 'documentation' LIMIT 1;
  IF v_page_id IS NULL THEN
    RAISE NOTICE 'documentation page not found, skipping';
    RETURN;
  END IF;

  UPDATE public.cms_page_blocks
     SET sort_order = 1000
   WHERE page_id = v_page_id AND block_type = 'cta';

  DELETE FROM public.cms_page_blocks
   WHERE page_id = v_page_id
     AND block_type = 'text'
     AND (config->>'anchor') IN (
       'installation','configuration','first-steps',
       'dashboard','sales-management','inventory-control',
       'authentication','endpoints','webhooks',
       'data-import','backups','reports',
       'mfa-setup','access-control','audit-logs',
       'pos-systems','accounting','delivery-platforms'
     );

  INSERT INTO public.cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
  (v_page_id, 'text', 10, true, jsonb_build_object(
    'anchor','installation',
    'title','Installation',
    'subtitle','Quick Start · Step 1',
    'body', E'Matbex is a fully cloud-hosted platform — there is nothing to install on your servers. You only need a modern browser (Chrome, Safari, Edge or Firefox) and, optionally, the Android POS app for terminal devices.\n\n## Create your workspace\n- Go to **[matbex.com/register](/register)** and sign up with your work email.\n- Confirm your email address from the verification link we send you.\n- Sign in and you will land on the **Onboarding** wizard.\n\n## Install the POS app (optional)\n- Download the latest Matbex POS APK from **Settings → Devices → Download App**.\n- Side-load the APK on each terminal and open it once to register the device.\n- Pair the terminal with your workspace using the pairing code shown on screen.\n\n## System requirements\n- Back office: any device with a modern browser and an internet connection.\n- POS terminal: Android 10+, 2 GB RAM, ESC/POS-compatible thermal printer and cash drawer.'
  )),
  (v_page_id, 'text', 11, true, jsonb_build_object(
    'anchor','configuration',
    'title','Configuration',
    'subtitle','Quick Start · Step 2',
    'body', E'Spend ten minutes configuring these basics before you record your first sale — it makes every downstream report accurate.\n\n## Restaurant profile\n- Go to **Settings → Restaurant** and set your legal name, VAT number, currency and timezone.\n- Upload your logo (used on receipts, the customer-facing site and emails).\n- Confirm the fiscal day cut-off (default 04:00 local time) so night shifts roll into the correct business day.\n\n## Branches\n- Add every physical location under **Settings → Branches**.\n- Each branch has its own opening hours, tax profile and cash drawer.\n\n## Tax & ZATCA (Saudi Arabia)\n- Enable VAT under **Settings → Tax** and enter your 15-digit VAT registration number.\n- For Saudi tenants, open **ZATCA Compliance** and complete onboarding for Phase 2 e-invoicing.\n\n## Payment methods\n- Activate the tenders you accept (cash, card, bank transfer, wallets) under **Settings → Payment Methods**.'
  )),
  (v_page_id, 'text', 12, true, jsonb_build_object(
    'anchor','first-steps',
    'title','First Steps',
    'subtitle','Quick Start · Step 3',
    'body', E'You are now ready to bring real operational data into Matbex. Follow these steps in order.\n\n## 1. Build your menu\n- Open **Menu → Categories** and create your sections (Starters, Mains, Drinks…).\n- Add items with prices, photos and recipes. Variants (quarter / half / full) are supported.\n\n## 2. Load opening inventory\n- Go to **Inventory → Items** and import your ingredients (CSV template available).\n- Enter opening stock counts and unit costs — this is the baseline for COGS.\n\n## 3. Invite your team\n- **Team → Add Member** to invite owners, managers, cashiers and waiters.\n- Each role has scoped permissions; cashiers are locked to Record Sale and Shifts.\n\n## 4. Open your first shift\n- On the POS, tap **Open Shift**, enter the opening cash balance and start selling.\n\n## 5. Reconcile at end of day\n- Close the shift, count the drawer and resolve any variance — the day is now ready to post.'
  )),
  (v_page_id, 'text', 20, true, jsonb_build_object(
    'anchor','dashboard',
    'title','Dashboard',
    'subtitle','User Guides · Operations',
    'body', E'The dashboard is your daily command centre. It shows revenue, gross profit, payables and KPI alerts for the current fiscal period.\n\n## Key cards\n- **Revenue today** — Net sales from all closed shifts and manual entries for the current business day.\n- **Gross profit** — Revenue minus COGS, updated as consumption is recorded.\n- **Cash on hand** — Sum of all open and closed drawer balances.\n- **Outstanding receivables** — Customer debts not yet settled.\n\n## Filters\n- Use the top-right preset (**Today / This Week / This Month / Custom**) to change the period.\n- The **This Month** preset respects your fiscal cycle start day, not the calendar month.\n\n## Alerts\n- The **Owner Alerts** panel surfaces variance spikes, negative inventory and unposted journal entries.\n- Click any alert to jump straight to the offending document.'
  )),
  (v_page_id, 'text', 21, true, jsonb_build_object(
    'anchor','sales-management',
    'title','Sales Management',
    'subtitle','User Guides · Operations',
    'body', E'Sales can be captured three ways: the POS terminal, the Record Sale page, or imported from a third-party POS.\n\n## Recording sales\n- **POS terminal** — most common; sales are posted live and tied to the active shift.\n- **Record Sale page** — for manual or backdated entries by owners and managers.\n\n## Shifts\n- Every sale belongs to a shift. Shifts have an opening balance, a closing balance and a variance.\n- Use **Shifts → Reassign** to move a misfiled sale to the correct shift.\n\n## Refunds & voids\n- Voids reverse a transaction inside the same shift; refunds create an offsetting ledger entry.\n- Both actions are immutable and require a reason code for audit.\n\n## Reports\n- **Sales by item, category, hour and channel** are available under **Reports → Sales**.'
  )),
  (v_page_id, 'text', 22, true, jsonb_build_object(
    'anchor','inventory-control',
    'title','Inventory Control',
    'subtitle','User Guides · Operations',
    'body', E'Matbex runs a perpetual inventory: every purchase increases stock, every recipe consumption decreases it, and stocktakes reconcile to actuals.\n\n## Purchases\n- Record supplier invoices under **Inventory → Purchases**. Multi-item invoices are supported.\n- Saved invoices automatically debit Inventory and credit Accounts Payable.\n\n## Stocktakes\n- Run a **Weekly COGS Wizard** for fast-moving items (chicken, vegetables) or a full monthly count.\n- COGS is calculated as **Opening + Purchases − Closing** at the end of each cycle.\n\n## Waste & spoilage\n- Record waste separately under **Inventory → Waste**. It posts to account 6100, not COGS.\n\n## Alerts\n- Low-stock and negative-stock alerts appear on the dashboard and in the Owner Alerts feed.'
  )),
  (v_page_id, 'text', 30, true, jsonb_build_object(
    'anchor','authentication',
    'title','Authentication',
    'subtitle','API Reference · Developers',
    'body', E'The Matbex API uses bearer tokens signed by our authentication service. Every request must include an Authorization: Bearer <token> header.\n\n## Getting a token\n- Go to **Settings → API Keys** and click **Generate key**.\n- Choose a scope (read-only, read-write, terminal) and an expiry.\n- Copy the token immediately — it is shown only once.\n\n## Using the token\n- Pass it as Authorization: Bearer <token> on every HTTPS call.\n- Tokens are tenant-scoped; you cannot read data outside the issuing workspace.\n\n## Rotation & revocation\n- Rotate keys at least every 90 days.\n- Revoke a key instantly from **Settings → API Keys → Revoke** — in-flight requests are rejected within seconds.'
  )),
  (v_page_id, 'text', 31, true, jsonb_build_object(
    'anchor','endpoints',
    'title','Endpoints',
    'subtitle','API Reference · Developers',
    'body', E'All endpoints are versioned under /v1 and return JSON. The OpenAPI spec is available at **/docs/terminal-api/matbex-terminal-api.openapi.yaml**.\n\n## Core resources\n- GET /v1/menu/items — list active menu items for the current branch.\n- POST /v1/sales — record a sale (idempotency-key required).\n- GET /v1/shifts/current — fetch the active shift for the calling terminal.\n- POST /v1/shifts/{id}/close — close a shift with the counted cash amount.\n- GET /v1/inventory/items — list ingredients and current stock levels.\n\n## Conventions\n- All timestamps are ISO-8601 with timezone (2026-05-26T18:30:00+03:00).\n- All amounts are decimal strings in the workspace currency.\n- Errors follow RFC 7807 (application/problem+json).'
  )),
  (v_page_id, 'text', 32, true, jsonb_build_object(
    'anchor','webhooks',
    'title','Webhooks',
    'subtitle','API Reference · Developers',
    'body', E'Webhooks let your systems react to Matbex events in real time — no polling required.\n\n## Subscribing\n- Go to **Settings → Webhooks** and add an HTTPS endpoint URL.\n- Pick the events you care about (sale.created, shift.closed, invoice.paid…).\n- Save — Matbex sends a ping event to verify the endpoint.\n\n## Payload\n- Every payload includes id, event, created_at, tenant_id and a typed data object.\n- A X-Matbex-Signature header carries an HMAC-SHA256 signature of the body.\n\n## Reliability\n- Failed deliveries are retried with exponential backoff for 24 hours.\n- View delivery history and replay individual events from **Settings → Webhooks → Logs**.'
  )),
  (v_page_id, 'text', 40, true, jsonb_build_object(
    'anchor','data-import',
    'title','Data Import',
    'subtitle','Data Management',
    'body', E'Bring historical data into Matbex without retyping it.\n\n## Supported imports\n- **Menu items** — CSV with category, name, price, cost, photo URL.\n- **Inventory** — CSV with ingredient name, unit, opening stock, unit cost.\n- **Customers** — CSV with name, phone, opening balance.\n- **Expenses** — CSV with date, category, vendor, amount, payment status (supports backdated entries).\n\n## How to import\n- Open the target page (Menu, Inventory, Customers, Expenses).\n- Click **Import** and download the template.\n- Fill it in, upload, review the validation summary, then confirm.\n\n## Tips\n- Validation runs on every row; errors are highlighted before any data is committed.\n- Large imports (>5,000 rows) are processed in the background — you will get an email when done.'
  )),
  (v_page_id, 'text', 41, true, jsonb_build_object(
    'anchor','backups',
    'title','Backups',
    'subtitle','Data Management',
    'body', E'Matbex performs automated, encrypted backups of every workspace so you never have to think about it.\n\n## What is backed up\n- All transactional data (sales, shifts, inventory, ledger entries).\n- Menu, customer and supplier records.\n- Uploaded files (logos, receipts, photos).\n\n## Schedule & retention\n- **Point-in-time recovery** within the last 7 days.\n- **Daily snapshots** kept for 30 days.\n- **Monthly snapshots** kept for 12 months.\n\n## Manual exports\n- Owners can trigger an on-demand export from **Settings → Data → Export workspace**.\n- The export is a ZIP of CSVs plus a JSON manifest, delivered via signed download link.'
  )),
  (v_page_id, 'text', 42, true, jsonb_build_object(
    'anchor','reports',
    'title','Reports',
    'subtitle','Data Management',
    'body', E'Matbex ships with a curated set of operational and financial reports. All reports can be exported to PDF, CSV or Excel.\n\n## Operational\n- **Daily sales summary** — revenue, transactions, average ticket, by shift.\n- **Hourly heatmap** — busiest hours by day of week.\n- **Item performance** — top sellers, slow movers, margin contribution.\n\n## Financial\n- **Profit & Loss** — full P&L for any period, with comparison.\n- **Trial Balance** — every account with debit/credit and closing balance.\n- **Cash flow** — opening, inflows, outflows, closing.\n\n## Scheduled emails\n- Configure daily, weekly or monthly email digests from **Settings → Reports → Schedules**.'
  )),
  (v_page_id, 'text', 50, true, jsonb_build_object(
    'anchor','mfa-setup',
    'title','MFA Setup',
    'subtitle','Security',
    'body', E'Multi-factor authentication adds a second layer of protection to every owner and manager account. It is **required** for owners.\n\n## Enable MFA\n- Open **Settings → Security → Two-factor authentication**.\n- Choose **Authenticator app** (recommended) or **SMS**.\n- Scan the QR code with Google Authenticator, 1Password, Authy or similar.\n- Enter the 6-digit code to confirm.\n\n## Recovery codes\n- Matbex generates 10 single-use recovery codes — download and store them somewhere safe.\n- Each code can only be used once and is invalidated immediately after use.\n\n## Losing access\n- An owner can reset another team member''s MFA from **Team → Member → Reset MFA**.\n- If all owners lose access, contact support with proof of business ownership.'
  )),
  (v_page_id, 'text', 51, true, jsonb_build_object(
    'anchor','access-control',
    'title','Access Control',
    'subtitle','Security',
    'body', E'Matbex uses role-based access control with tenant-scoped row-level security on every table.\n\n## Built-in roles\n- **Owner** — full access including billing, deletes and irreversible actions.\n- **Manager** — operational access; cannot change billing or delete the workspace.\n- **Accountant** — read/write on financial modules, read-only elsewhere.\n- **Cashier** — locked to **Record Sale** and **Shifts**; cannot view reports.\n- **Waiter** — POS order-taking only.\n\n## Branch-based access\n- Members can be scoped to one or more branches under **Team → Member → Branches**.\n- Branch-scoped users only see data for their assigned branches.\n\n## Best practices\n- Use the **principle of least privilege** — assign the narrowest role that gets the job done.\n- Revoke access immediately on termination via **Team → Member → Deactivate**.'
  )),
  (v_page_id, 'text', 52, true, jsonb_build_object(
    'anchor','audit-logs',
    'title','Audit Logs',
    'subtitle','Security',
    'body', E'Every privileged action in Matbex is recorded in an immutable audit log. Logs cannot be edited or deleted, even by owners.\n\n## What is logged\n- Sign-ins, sign-outs and failed login attempts.\n- Permission and role changes.\n- Sales voids, refunds, manual journal entries and price overrides.\n- Inventory adjustments, waste records and stocktake submissions.\n- Settings changes (tax profile, fiscal cycle, integrations).\n\n## Reviewing the log\n- Open **Settings → Audit Logs**.\n- Filter by actor, action type, target object or date range.\n- Export the filtered view to CSV for external review.\n\n## Retention\n- Logs are retained for **7 years** to satisfy ZATCA and most tax authorities.'
  )),
  (v_page_id, 'text', 60, true, jsonb_build_object(
    'anchor','pos-systems',
    'title','POS Systems',
    'subtitle','Integrations',
    'body', E'Already running a third-party POS? Matbex can ingest its sales data so your back office stays the single source of truth.\n\n## Supported POS systems\n- **Foodics** — real-time sales sync via webhook.\n- **Square** — daily sales pull via the Square API.\n- **Toast** — CSV import (daily) or partner-grade API on enterprise plans.\n- **Generic** — any POS that can export a CSV of sales matching our template.\n\n## How to connect\n- Open **Settings → Integrations → POS** and pick your provider.\n- Authenticate (OAuth) or paste your API key as instructed.\n- Map POS items to Matbex menu items — unmapped items post to a "Misc" category until reviewed.\n\n## Behaviour\n- Imported sales create the same ledger entries as a native POS sale.\n- Inventory deductions follow the recipes attached to the mapped Matbex item.'
  )),
  (v_page_id, 'text', 61, true, jsonb_build_object(
    'anchor','accounting',
    'title','Accounting',
    'subtitle','Integrations',
    'body', E'Sync your Matbex ledger with your accounting platform so your accountant works in the tools they know.\n\n## Supported platforms\n- **QuickBooks Online** — journal sync, customer & supplier sync, invoice export.\n- **Xero** — journal sync, contact sync, attached PDFs.\n- **Zoho Books** — bidirectional sync of invoices and payments.\n\n## Connecting\n- Open **Settings → Integrations → Accounting** and pick your platform.\n- Authorize via OAuth — no API keys to manage.\n- Map your Matbex chart-of-accounts to the destination accounts.\n\n## Sync cadence\n- Journals post nightly by default (configurable to hourly on Pro+).\n- Manual **Sync now** is available on the integration page.\n- The sync log shows every push with status and any reconciliation errors.'
  )),
  (v_page_id, 'text', 62, true, jsonb_build_object(
    'anchor','delivery-platforms',
    'title','Delivery Platforms',
    'subtitle','Integrations',
    'body', E'Pull orders from food-delivery aggregators directly into Matbex so revenue, commissions and COGS land in the right places.\n\n## Supported aggregators\n- **HungerStation** — order webhook + menu sync.\n- **Jahez** — order webhook + nightly settlement file.\n- **ToYou** — order webhook.\n- **Talabat** — partner API on enterprise plans; CSV import otherwise.\n\n## What gets imported\n- Each order creates a sale tagged with the aggregator as the channel.\n- Aggregator commissions post automatically to **Account 5200 – Delivery commissions**.\n- Promotions and discounts are tracked separately so you can see net vs gross channel revenue.\n\n## Menu sync\n- Toggle items as available/sold-out on the aggregator side from **Live Menu → Channel availability**.'
  ));
END
$$;