-- Open checks, phase 2b.2 of docs/plans/open-checks.md: voiding items already sent to the
-- kitchen (recorded as waste), service charge per branch, and the day-end guard.

-- ---- service charge per branch ---------------------------------------------------------
-- A percentage of an open check's lines, added when the check is paid (as the sale's
-- document surcharge, so it is in the VAT base and on the ZATCA invoice). 0 = off.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS service_charge_percent numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_service_charge_percent;
ALTER TABLE public.branches ADD CONSTRAINT branches_service_charge_percent
  CHECK (service_charge_percent >= 0 AND service_charge_percent <= 100);
COMMENT ON COLUMN public.branches.service_charge_percent IS
  'Service charge on open checks (dine-in), percent of the lines; 0 = none. Charged as the sale''s document surcharge.';

-- A manager can waive it on one check.
ALTER TABLE public.pos_checks
  ADD COLUMN IF NOT EXISTS service_charge_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_charge_waived_by uuid,
  ADD COLUMN IF NOT EXISTS service_charge_waive_reason text;

-- What a sale charged as service (part of document_surcharge), for reports.
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS service_charge numeric(12,2) NOT NULL DEFAULT 0;

-- ---- voiding sent items ----------------------------------------------------------------
-- Who allowed the void: a manager/owner by role, or the admin PIN; what the waste cost.
ALTER TABLE public.pos_check_lines
  ADD COLUMN IF NOT EXISTS void_approved_by uuid,
  ADD COLUMN IF NOT EXISTS void_approval text,
  ADD COLUMN IF NOT EXISTS waste_cost numeric(12,4);
ALTER TABLE public.pos_check_lines DROP CONSTRAINT IF EXISTS pos_check_lines_void_approval;
ALTER TABLE public.pos_check_lines ADD CONSTRAINT pos_check_lines_void_approval
  CHECK (void_approval IS NULL OR void_approval IN ('unsent', 'role', 'admin_pin'));

-- The kitchen item a check line became, so voiding the line cancels it.
ALTER TABLE public.pos_kds_ticket_items
  ADD COLUMN IF NOT EXISTS check_line_id uuid REFERENCES public.pos_check_lines(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pos_kds_ticket_items_check_line_idx
  ON public.pos_kds_ticket_items (check_line_id) WHERE check_line_id IS NOT NULL;

-- Waste from a voided sent item points at its line (reports, audits).
ALTER TABLE public.waste_records
  ADD COLUMN IF NOT EXISTS check_line_id uuid REFERENCES public.pos_check_lines(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS waste_records_check_line_idx
  ON public.waste_records (check_line_id) WHERE check_line_id IS NOT NULL;

-- ---- day end: no closing with checks still open -----------------------------------------
CREATE OR REPLACE FUNCTION public.validate_day_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_open integer;
BEGIN
  -- Only check when changing to 'closed' status
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    -- Check if variance is too high and unresolved
    IF NEW.variance_status = 'investigate' AND NEW.variance_resolved_at IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot close day with unresolved variance of %. Please investigate and resolve the discrepancy before closing.', NEW.variance_amount;
    END IF;

    -- Ensure mandatory fields are present
    IF NEW.cash_sales IS NULL OR NEW.card_sales IS NULL OR NEW.delivery_sales IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: All payment types (Cash, Card, Delivery) must be recorded before closing the day.';
    END IF;

    -- Open checks (docs/plans/open-checks.md): a check opened on or before this business
    -- day must be paid or voided first, or its sales would land after the day was closed.
    SELECT count(*) INTO v_open
      FROM public.pos_checks c
      JOIN public.restaurants r ON r.id = c.restaurant_id
     WHERE c.restaurant_id = NEW.restaurant_id
       AND c.status = 'open'
       AND (NEW.branch_id IS NULL OR c.branch_id IS NULL OR c.branch_id = NEW.branch_id)
       AND (c.opened_at AT TIME ZONE COALESCE(r.timezone, 'Asia/Riyadh'))::date <= NEW.sales_date;
    IF v_open > 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot close the day: % open check(s). Pay or void them first (Record sale → Open checks).', v_open;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
