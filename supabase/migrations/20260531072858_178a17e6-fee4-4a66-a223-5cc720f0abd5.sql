ALTER TABLE public.online_ordering_settings
  ADD COLUMN IF NOT EXISTS delivery_fee_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rider_commission_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS rider_commission numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.online_ordering_settings.delivery_fee_tiers IS
  'JSON array of tiered delivery fees: [{"min_subtotal": 0, "max_subtotal": 50, "fee": 15}, ...]. Falls back to delivery_fee_flat when empty.';
COMMENT ON COLUMN public.online_ordering_settings.rider_commission_pct IS
  'Internal % of delivery fee paid to rider (aggregator-style). Does NOT increase customer total.';
COMMENT ON COLUMN public.online_orders.rider_commission IS
  'Snapshot of rider commission amount (internal). delivery_fee - rider_commission = restaurant net delivery revenue.';