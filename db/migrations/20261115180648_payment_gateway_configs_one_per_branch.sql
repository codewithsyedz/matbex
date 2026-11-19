-- payment_gateway_configs_one_per_branch
--
-- One configuration per business, branch and gateway. The unique key treated NULL branch_id
-- (the business-wide row) as always distinct, so every Save in Settings → Payment gateways
-- (an upsert on tenant_id, branch_id, gateway) inserted another business-wide row. Keep the
-- most recently changed row of each group, then make NULLs count as equal.

DELETE FROM public.payment_gateway_configs c
USING (
  SELECT id, row_number() OVER (
    PARTITION BY tenant_id, branch_id, gateway
    ORDER BY updated_at DESC, created_at DESC, id
  ) AS n
  FROM public.payment_gateway_configs
) d
WHERE c.id = d.id AND d.n > 1;

ALTER TABLE public.payment_gateway_configs
  DROP CONSTRAINT IF EXISTS payment_gateway_configs_tenant_id_branch_id_gateway_key;
ALTER TABLE public.payment_gateway_configs
  ADD CONSTRAINT payment_gateway_configs_tenant_id_branch_id_gateway_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, gateway);
