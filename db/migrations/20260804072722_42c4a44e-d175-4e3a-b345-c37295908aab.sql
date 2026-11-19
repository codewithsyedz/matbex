CREATE TABLE IF NOT EXISTS public.kpi_alerts_keepers AS
SELECT DISTINCT ON (restaurant_id, alert_type, reference_date) id
FROM public.kpi_alerts
ORDER BY restaurant_id, alert_type, reference_date, triggered_at DESC, id DESC;

CREATE UNIQUE INDEX IF NOT EXISTS kpi_alerts_keepers_id ON public.kpi_alerts_keepers (id);

GRANT ALL ON public.kpi_alerts_keepers TO service_role;
ALTER TABLE public.kpi_alerts_keepers ENABLE ROW LEVEL SECURITY;