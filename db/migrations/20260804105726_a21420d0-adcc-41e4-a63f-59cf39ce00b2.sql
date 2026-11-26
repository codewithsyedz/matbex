-- 1) From linked day-end adjustments
UPDATE public.journal_entry_batches b
SET branch_id = d.branch_id
FROM public.day_end_adjustments d
WHERE b.branch_id IS NULL AND d.ledger_batch_id = b.id AND d.branch_id IS NOT NULL;

-- 2) From linked daily sales summaries
UPDATE public.journal_entry_batches b
SET branch_id = s.branch_id
FROM public.daily_sales_summary s
WHERE b.branch_id IS NULL AND s.ledger_batch_id = b.id AND s.branch_id IS NOT NULL;

-- 3) From the batch's own ledger lines when they all share one branch
UPDATE public.journal_entry_batches b
SET branch_id = x.bid
FROM (
  SELECT t.batch_id, MIN(t.branch_id::text)::uuid AS bid
  FROM public.account_transactions t
  WHERE t.branch_id IS NOT NULL AND t.batch_id IS NOT NULL
  GROUP BY t.batch_id
  HAVING COUNT(DISTINCT t.branch_id) = 1
) x
WHERE b.branch_id IS NULL AND x.batch_id = b.id;

-- 4) Remaining: fall back to the tenant's primary branch
UPDATE public.journal_entry_batches b
SET branch_id = pb.id
FROM public.branches pb
JOIN public.restaurants r ON r.id = pb.restaurant_id
WHERE b.branch_id IS NULL
  AND r.tenant_id = b.tenant_id
  AND pb.is_primary = true
  AND pb.deleted_at IS NULL;

-- 5) Stamp branch on ledger lines from their batch
UPDATE public.account_transactions t
SET branch_id = b.branch_id
FROM public.journal_entry_batches b
WHERE t.batch_id = b.id AND t.branch_id IS NULL AND b.branch_id IS NOT NULL;