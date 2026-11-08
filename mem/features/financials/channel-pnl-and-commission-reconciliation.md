---
name: Channel P&L and Commission Reconciliation
description: Per-channel revenue/commission/margin reporting and aggregator payout reconciliation
type: feature
---
- New column `account_transactions.channel` tags every ledger row with sales channel (direct/hungerstation/jahez/mrsool/talabat/qr/waiter).
- System accounts auto-seeded per tenant by `public.ensure_aggregator_accounts(tenant_id)`:
  - 2150 Aggregator Clearing (liability)
  - 4010 Aggregator Sales (revenue)
  - 6300 Commission Expense - Aggregators (expense)
- Trigger `trg_post_aggregator_order_paid` on `online_orders`: when an aggregator order flips to `payment_status='paid'`, posts:
  - DR 2150 (gross), CR 4010 (gross-commission), DR 6300 + CR 2150 (commission). Net clearing balance = expected payout.
- Table `aggregator_settlements` (tenant-scoped RLS via `has_tenant_role`): owners/managers record payouts, owners can soft-delete. Marking `status='reconciled'` fires `trg_post_aggregator_settlement` which posts DR Bank (default code 1100) / CR 2150 for net_payout.
- Helper `has_tenant_role(uuid, uuid, app_role)` checks role across any restaurant of a tenant (existing `has_role` is restaurant-scoped).
- View `v_channel_profitability` exposes per-channel daily debit/credit on accounts 4010/6300/2150 for the report.
- Page `/channel-pnl` (sidebar Finance group, flag `channel_pnl_enabled`): tabs "Profitability" (KPIs + by-channel table for fiscal month) and "Settlements" (record/reconcile UI).
- Hooks: `useChannelProfitability(from,to)`, `useAggregatorSettlements()`.
- Currency formatter uses ﷼ Riyal symbol inline (no useCurrency dependency to keep page light).