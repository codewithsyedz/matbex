
-- =========================================================================
-- 1) Settings (singleton)
-- =========================================================================
CREATE TABLE public.landing_comparison_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  eyebrow TEXT NOT NULL DEFAULT 'Market comparison',
  eyebrow_ar TEXT,
  headline_prefix TEXT NOT NULL DEFAULT 'Same stack.',
  headline_prefix_ar TEXT,
  headline_bold TEXT NOT NULL DEFAULT 'A fraction of the price.',
  headline_bold_ar TEXT,
  subtitle TEXT NOT NULL DEFAULT '',
  subtitle_ar TEXT,
  footnote TEXT NOT NULL DEFAULT '',
  footnote_ar TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.landing_comparison_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_comparison_settings TO authenticated;
GRANT ALL ON public.landing_comparison_settings TO service_role;

ALTER TABLE public.landing_comparison_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active comparison settings"
  ON public.landing_comparison_settings FOR SELECT
  USING (is_active = true);

CREATE POLICY "SuperAdmin can manage comparison settings"
  ON public.landing_comparison_settings FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

-- =========================================================================
-- 2) Competitor columns
-- =========================================================================
CREATE TABLE public.landing_comparison_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  column_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ar TEXT,
  sublabel TEXT,
  sublabel_ar TEXT,
  is_highlighted BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.landing_comparison_columns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_comparison_columns TO authenticated;
GRANT ALL ON public.landing_comparison_columns TO service_role;

ALTER TABLE public.landing_comparison_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active comparison columns"
  ON public.landing_comparison_columns FOR SELECT
  USING (is_active = true);

CREATE POLICY "SuperAdmin can manage comparison columns"
  ON public.landing_comparison_columns FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

-- =========================================================================
-- 3) Rows
-- =========================================================================
CREATE TABLE public.landing_comparison_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  label_ar TEXT,
  -- cells is { "matbex": true|false|"addon"|"199 ﷼", "foodics": ..., ... }
  cells JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_footer BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.landing_comparison_rows TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_comparison_rows TO authenticated;
GRANT ALL ON public.landing_comparison_rows TO service_role;

ALTER TABLE public.landing_comparison_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active comparison rows"
  ON public.landing_comparison_rows FOR SELECT
  USING (is_active = true);

CREATE POLICY "SuperAdmin can manage comparison rows"
  ON public.landing_comparison_rows FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

-- =========================================================================
-- 4) updated_at triggers (reuse existing function)
-- =========================================================================
CREATE TRIGGER trg_landing_comparison_settings_updated_at
  BEFORE UPDATE ON public.landing_comparison_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_landing_comparison_columns_updated_at
  BEFORE UPDATE ON public.landing_comparison_columns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_landing_comparison_rows_updated_at
  BEFORE UPDATE ON public.landing_comparison_rows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 5) Seed with current landing page content
-- =========================================================================
INSERT INTO public.landing_comparison_settings (eyebrow, headline_prefix, headline_bold, subtitle, footnote)
VALUES (
  'Market comparison',
  'Same stack.',
  'A fraction of the price.',
  'Most KSA platforms sell POS cheap, then charge extra for every module that actually runs your business. Matbex Growth Bundle includes everything - for less than competitors charge for POS alone.',
  'Competitor pricing based on publicly listed rates and add-on modules as of 2026. Actual cost varies by branch count, modules selected, and contract terms.'
);

INSERT INTO public.landing_comparison_columns (column_key, name, sublabel, is_highlighted, sort_order) VALUES
  ('matbex', 'Matbex', 'Growth Bundle', true, 1),
  ('foodics', 'Foodics', 'Base + modules', false, 2),
  ('marn', 'Marn', 'Pro plan', false, 3),
  ('rasta', 'Rasta', 'Standard', false, 4);

INSERT INTO public.landing_comparison_rows (label, cells, is_footer, sort_order) VALUES
  ('Monthly price (per branch)',                       '{"matbex":"199 ﷼","foodics":"299 ﷼","marn":"249 ﷼","rasta":"199 ﷼"}'::jsonb, false, 1),
  ('POS + Cash Drawer + Shifts',                       '{"matbex":true,"foodics":true,"marn":true,"rasta":true}'::jsonb,             false, 2),
  ('ZATCA Phase 2 e-invoicing',                        '{"matbex":true,"foodics":true,"marn":true,"rasta":true}'::jsonb,             false, 3),
  ('Full Accounting (CoA, P&L, Trial Balance)',        '{"matbex":true,"foodics":"addon","marn":"addon","rasta":false}'::jsonb,      false, 4),
  ('Real-time COGS & Recipe Costing',                  '{"matbex":true,"foodics":"addon","marn":false,"rasta":false}'::jsonb,        false, 5),
  ('Automated Payroll & Staff Advances',               '{"matbex":true,"foodics":"addon","marn":"addon","rasta":false}'::jsonb,      false, 6),
  ('Customer Debt & Loyalty',                          '{"matbex":true,"foodics":"addon","marn":false,"rasta":false}'::jsonb,        false, 7),
  ('Profit Forecasting & Daily Email Summaries',       '{"matbex":true,"foodics":false,"marn":false,"rasta":false}'::jsonb,          false, 8),
  ('Arabic-first + RTL native',                        '{"matbex":true,"foodics":true,"marn":true,"rasta":true}'::jsonb,             false, 9),
  ('All-in cost for full stack',                       '{"matbex":"199 ﷼","foodics":"~750 ﷼","marn":"~500 ﷼","rasta":"~400 ﷼"}'::jsonb, true, 10);
