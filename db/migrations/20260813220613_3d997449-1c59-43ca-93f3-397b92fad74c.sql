DO $$
DECLARE r record; d date;
BEGIN
  FOR r IN SELECT id FROM public.restaurants LOOP
    d := current_date - 60;
    WHILE d <= current_date LOOP
      PERFORM public.run_daily_reconciliation(r.id, d);
      d := d + 1;
    END LOOP;
  END LOOP;
END $$;