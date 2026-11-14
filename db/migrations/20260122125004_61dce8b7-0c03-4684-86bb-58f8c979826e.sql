
-- Fix the update_customer_balance function to include balance adjustments
CREATE OR REPLACE FUNCTION public.update_customer_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sales_total NUMERIC;
  adjustments_total NUMERIC;
  target_customer_id UUID;
BEGIN
  -- Handle INSERT (OLD is null)
  IF TG_OP = 'INSERT' THEN
    target_customer_id := NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    target_customer_id := NEW.customer_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_customer_id := OLD.customer_id;
  END IF;

  -- Recalculate customer balance based on unpaid transactions AND adjustments
  IF target_customer_id IS NOT NULL THEN
    -- Sum of unpaid sales
    SELECT COALESCE(SUM(total), 0) INTO sales_total
    FROM public.sales_transactions
    WHERE customer_id = target_customer_id
      AND settlement_status = 'unpaid';
    
    -- Sum of adjustments (credits/write_offs subtract, debits/corrections add)
    SELECT COALESCE(SUM(
      CASE 
        WHEN adjustment_type IN ('credit', 'write_off') THEN -amount 
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
  
  -- Also update old customer if changed (for UPDATE operations)
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS NOT NULL AND OLD.customer_id != NEW.customer_id THEN
    -- Sum of unpaid sales for old customer
    SELECT COALESCE(SUM(total), 0) INTO sales_total
    FROM public.sales_transactions
    WHERE customer_id = OLD.customer_id
      AND settlement_status = 'unpaid';
    
    -- Sum of adjustments for old customer
    SELECT COALESCE(SUM(
      CASE 
        WHEN adjustment_type IN ('credit', 'write_off') THEN -amount 
        ELSE amount 
      END
    ), 0) INTO adjustments_total
    FROM public.customer_balance_adjustments
    WHERE customer_id = OLD.customer_id;
    
    UPDATE public.customers
    SET current_balance = GREATEST(0, sales_total + adjustments_total),
        updated_at = now()
    WHERE id = OLD.customer_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Also fix the apply_balance_adjustment function to use the same comprehensive calculation
CREATE OR REPLACE FUNCTION public.apply_balance_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  sales_total NUMERIC;
  adjustments_total NUMERIC;
BEGIN
  -- Sum of unpaid sales
  SELECT COALESCE(SUM(total), 0) INTO sales_total
  FROM public.sales_transactions
  WHERE customer_id = NEW.customer_id
    AND settlement_status = 'unpaid';
  
  -- Sum of adjustments (including the new one being inserted)
  SELECT COALESCE(SUM(
    CASE 
      WHEN adjustment_type IN ('credit', 'write_off') THEN -amount 
      ELSE amount 
    END
  ), 0) INTO adjustments_total
  FROM public.customer_balance_adjustments
  WHERE customer_id = NEW.customer_id;

  -- Update customer balance
  UPDATE public.customers
  SET current_balance = GREATEST(0, sales_total + adjustments_total),
      updated_at = now()
  WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;
