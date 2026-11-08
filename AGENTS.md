# Architecture rules
- Subscription checkout and success verification use server-validated owner membership and allowlisted Stripe prices; only paid, active, tenant-bound subscriptions activate existing trials, independently of application registration.

- Apply Starter plan route restrictions only inside TenantRoute; LazyRoute renders public/auth/payment pages without plan checks so upgrades and account recovery stay accessible.

- ZATCA provider applications are separate records per submission; retain each record and its original document links for account history.
- Demo bookings are stored in contact_messages and linked to lead_attributions by lead_ref, so lead reports read actual booking details rather than copying them.
- Expense VAT reversals use the authorized expense correction RPC; amendments offset both original expense lines and retroactive VAT correction lines before reposting, preserving balanced immutable history.
- Accountant inventory creation is authorized at both navigation and database levels; creation respects the selected branch without granting inventory deletion.
- Accountant-only sessions render a lazy accountant dashboard at /dashboard; queries use real restaurant-scoped data, paginated totals, separate period metrics and all-date review backlog without admin privileges.
- Accountant pending-work emails use a dedicated authenticated function with fixed recipient/restaurant, caller-scoped reads and content-derived idempotency; dashboard refresh invokes it because background database-webhook provisioning is unavailable. Never add email queues, tables or cron migrations.