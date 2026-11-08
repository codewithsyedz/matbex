-- Update the balance calculation function to include 'settlement' as a reducing adjustment type
CREATE OR REPLACE FUNCTION public.update_customer_balance()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  target_customer_id uuid;
  sales_total numeric;
  adjustments_total numeric;
BEGIN
  -- Determine which customer to update
  IF TG_TABLE_NAME = 'sales_transactions' THEN
    target_customer_id := COALESCE(NEW.customer_id, OLD.customer_id);
  ELSIF TG_TABLE_NAME = 'customer_balance_adjustments' THEN
    target_customer_id := COALESCE(NEW.customer_id, OLD.customer_id);
  END IF;

  -- Recalculate customer balance based on unpaid transactions AND adjustments
  IF target_customer_id IS NOT NULL THEN
    -- Sum of unpaid sales
    SELECT COALESCE(SUM(total), 0) INTO sales_total
    FROM public.sales_transactions
    WHERE customer_id = target_customer_id
      AND settlement_status = 'unpaid';
    
    -- Sum of adjustments (credits/write_offs/settlements subtract, debits/corrections add)
    SELECT COALESCE(SUM(
      CASE 
        WHEN adjustment_type IN ('credit', 'write_off', 'settlement') THEN -amount 
        ELSE amount 
      END
    ), 0) INTO adjustments_total
    FROM public.customer_balance_adjustments
    WHERE customer_id = target_customer_id;
    
    UPDATE public.customers
    SET current_balance = GREATEST(0, sales_total + adjustments_total),
        updated_at = now()
    WHERE id = target_customer_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Also update apply_balance_adjustment function to handle settlement type
CREATE OR REPLACE FUNCTION public.apply_balance_adjustment()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment_value numeric;
BEGIN
  -- Determine adjustment direction based on type
  -- credit, write_off, settlement = reduce balance (negative)
  -- debit, correction = increase balance (positive)
  IF NEW.adjustment_type IN ('credit', 'write_off', 'settlement') THEN
    adjustment_value := -NEW.amount;
  ELSE
    adjustment_value := NEW.amount;
  END IF;

  -- Update customer balance
  UPDATE public.customers
  SET current_balance = GREATEST(0, current_balance + adjustment_value),
      updated_at = now()
  WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;