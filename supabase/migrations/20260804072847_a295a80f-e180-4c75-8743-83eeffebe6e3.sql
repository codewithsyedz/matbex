DELETE FROM public.kpi_alerts
WHERE ctid IN (
  SELECT k.ctid FROM public.kpi_alerts k
  WHERE NOT EXISTS (SELECT 1 FROM public.kpi_alerts_keepers p WHERE p.id = k.id)
  LIMIT 400000
);