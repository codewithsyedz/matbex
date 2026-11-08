# Roadmap
- [x] Connected Starter billing to Stripe at SAR 149/month; completed a test payment, verified confirmation and active Starter dashboard readback. Live payments remain unconfigured on the existing test gateway.

- [x] Reproduced Starter locks on six public/auth/payment routes; limited the plan gate to tenant routes and added regression coverage preserving Growth-only accounting restrictions.

- [x] Added dashboard-open/refresh emails to dev@matbex.com with restaurant scope, pending VAT/expense reviews and low-stock checks; real current-backlog email sent and rules tested.
- [ ] Alerts while the accountant dashboard is closed remain blocked on a supported background database-webhook connection; no email queues, tables or polling jobs created.

- [x] Built accountant dashboard with live VAT, expense totals, current inventory and filterable review backlog; verified real accountant access, expense review links, inventory action, and Arabic/mobile display.

- [x] Verified real accountant inventory creation, VAT reversal from 15 to 0, and unposted expense correction from 115 to 125; read back after reload and archived test records. Posted-ledger amendment was not exercised against live books.

- [x] Enable accountant VAT reversal with an audit trail and balanced ledger correction; verified temporary unposted expense reversal.
- [x] Enable accountant inventory entry with tenant and branch permissions preserved; role tests passed.
- [x] Enable expense amount corrections without modifying posted ledger history; verified temporary expense edit and amendment tests.

- [x] Sign up through pricing and verify a real Starter 14-day trial, dashboard, till and populated daily report.
- [x] Preserve past ZATCA applications with reference number, submission date, status and documents; verified separate drafts persist after reload.
- [x] Verify the bilingual demo booking page saves a booking, emails the owner and displays its details in Lead Sources; removed the test booking.
- [ ] Ad-platform conversion delivery remains blocked on connecting an advertising account.
- [ ] Direct ZATCA portal submission remains external; record the official reference after portal submission.
