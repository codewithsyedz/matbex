CREATE OR REPLACE FUNCTION public.validate_sales_date_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_closed_date DATE;
  v_month_start DATE;
BEGIN
  -- Block future dates entirely
  IF NEW.sales_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Cannot create sales entry for future date %.', NEW.sales_date;
  END IF;

  -- Forward-gap protection: only enforced within the same calendar month as NEW.sales_date.
  -- Prior months are allowed to have gaps (so backdating across months is not blocked).
  IF NEW.status = 'closed' THEN
    v_month_start := date_trunc('month', NEW.sales_date)::date;

    SELECT MAX(sales_date)
    INTO v_last_closed_date
    FROM public.daily_sales_summary
    WHERE restaurant_id = NEW.restaurant_id
      AND status = 'closed'
      AND sales_date < NEW.sales_date
      AND sales_date >= v_month_start
      AND id <> NEW.id;

    IF v_last_closed_date IS NOT NULL
       AND NEW.sales_date > v_last_closed_date + INTERVAL '1 day' THEN
      IF EXISTS (
        SELECT 1
        FROM generate_series(v_last_closed_date + 1, NEW.sales_date - 1, INTERVAL '1 day') AS d(day)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.daily_sales_summary dss
          WHERE dss.restaurant_id = NEW.restaurant_id
            AND dss.sales_date = d.day::date
            AND dss.status = 'closed'
        )
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Cannot close date % - there are unclosed days between % and % in the same month. Please close days in sequence within the current month.',
          NEW.sales_date, v_last_closed_date, NEW.sales_date;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;