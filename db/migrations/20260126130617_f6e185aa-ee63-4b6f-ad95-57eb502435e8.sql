-- Landing page content tables for SuperAdmin CMS

-- Hero Section Content
CREATE TABLE public.landing_hero (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eyebrow TEXT NOT NULL DEFAULT 'The Future of Hospitality Management',
  headline TEXT NOT NULL DEFAULT 'Your Entire Restaurant, Synchronized.',
  subheadline TEXT NOT NULL DEFAULT 'From real-time COGS tracking to automated payroll. Matbex is the only platform that treats your kitchen like a high-performance engine.',
  primary_cta_text TEXT NOT NULL DEFAULT 'Start Free Trial',
  secondary_cta_text TEXT NOT NULL DEFAULT 'Watch Demo',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Features for Bento Grid
CREATE TABLE public.landing_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Scale',
  size TEXT NOT NULL DEFAULT 'small' CHECK (size IN ('small', 'medium', 'large')),
  color TEXT NOT NULL DEFAULT 'emerald',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Testimonials
CREATE TABLE public.landing_testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  avatar_emoji TEXT DEFAULT '👨‍🍳',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pricing Plans
CREATE TABLE public.landing_pricing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  monthly_price INTEGER,
  annual_price INTEGER,
  description TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_text TEXT NOT NULL DEFAULT 'Start Free Trial',
  is_highlighted BOOLEAN DEFAULT false,
  badge_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FAQ Items
CREATE TABLE public.landing_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.landing_hero ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_faq ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is superadmin
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.superadmin_users WHERE user_id = _user_id
  )
$$;

-- Public read policies (anyone can view landing content)
CREATE POLICY "Anyone can view active hero" ON public.landing_hero
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active features" ON public.landing_features
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active testimonials" ON public.landing_testimonials
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active pricing" ON public.landing_pricing_plans
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active faq" ON public.landing_faq
  FOR SELECT USING (is_active = true);

-- SuperAdmin full access policies
CREATE POLICY "SuperAdmin can manage hero" ON public.landing_hero
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage features" ON public.landing_features
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage testimonials" ON public.landing_testimonials
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage pricing" ON public.landing_pricing_plans
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage faq" ON public.landing_faq
  FOR ALL USING (public.is_superadmin(auth.uid()));

-- Seed default content
INSERT INTO public.landing_hero (eyebrow, headline, subheadline, primary_cta_text, secondary_cta_text) VALUES
('The Future of Hospitality Management', 'Your Entire Restaurant, Synchronized.', 'From real-time COGS tracking to automated payroll. Matbex is the only platform that treats your kitchen like a high-performance engine.', 'Start Free Trial', 'Watch Demo');

INSERT INTO public.landing_features (title, description, icon, size, color, sort_order) VALUES
('Inventory & COGS', 'Real-time COGS. Stop guessing, start profiting.', 'Scale', 'large', 'emerald', 1),
('Automated Payroll', 'One-click payroll for FOH and BOH.', 'Calendar', 'small', 'blue', 2),
('Menu Engineering', 'Identify your stars and your dogs.', 'BarChart2', 'small', 'purple', 3),
('Unified Accounting', 'P&L statements that update with every order.', 'BookOpen', 'medium', 'amber', 4),
('Supplier Portal', 'Automate your ordering cycle.', 'Mail', 'small', 'rose', 5),
('Multi-Location', 'Centralized control, local flexibility.', 'Globe', 'small', 'cyan', 6),
('Real-time Sync', 'Every transaction, instantly recorded.', 'Zap', 'small', 'yellow', 7),
('Compliance Ready', 'AES-256 encryption. GDPR compliant.', 'Shield', 'small', 'slate', 8),
('Shift Management', 'Clock-ins, breaks, overtime-automated.', 'Clock', 'small', 'indigo', 9);

INSERT INTO public.landing_testimonials (quote, author_name, author_role, restaurant_name, avatar_emoji, sort_order) VALUES
('Matbex gave me back 15 hours a week in admin time. The COGS tracking is scarily accurate.', 'Chef Marcus', 'Executive Chef', 'The Gilded Fig', '👨‍🍳', 1),
('We reduced our food waste by 23% in the first quarter. The ROI was immediate.', 'Sarah Chen', 'Owner', 'Jade Garden', '👩‍💼', 2),
('Finally, a system that speaks both kitchen and accounting. My CFO loves me now.', 'Miguel Torres', 'Managing Partner', 'Casa Oaxaca', '👨‍💻', 3),
('The payroll automation alone saved us $2,400/month in bookkeeping fees.', 'Amanda Wright', 'Operations Director', 'Wright Hospitality Group', '👩‍🍳', 4),
('I can see my P&L in real-time. No more waiting until month-end to know if we are profitable.', 'James Kim', 'Owner', 'Seoul Kitchen', '👨‍🍳', 5);

INSERT INTO public.landing_pricing_plans (name, tagline, monthly_price, annual_price, description, features, cta_text, is_highlighted, badge_text, sort_order) VALUES
('Essentials', 'The Bistro', 99, 79, 'Perfect for single-location restaurants getting started.', '["POS Integration", "Basic Inventory Tracking", "Daily Sales Reports", "Up to 10 Staff Members", "Email Support"]'::jsonb, 'Start Free Trial', false, NULL, 1),
('Pro', 'The Brasserie', 199, 159, 'Full-featured solution for serious operators.', '["Everything in Essentials", "Advanced COGS Analysis", "Automated Payroll", "Recipe Costing", "API Access", "Unlimited Staff", "Priority Support"]'::jsonb, 'Start Free Trial', true, 'Most Popular', 2),
('Enterprise', 'The Empire', NULL, NULL, 'For multi-location groups and franchises.', '["Everything in Pro", "Multi-Location Dashboard", "Centralized Accounting", "Custom Integrations", "Dedicated Account Manager", "On-site Training", "SLA Guarantee"]'::jsonb, 'Contact Sales', false, NULL, 3);

INSERT INTO public.landing_faq (question, answer, sort_order) VALUES
('Can I migrate from my current POS?', 'Yes! Matbex integrates with all major POS systems including Square, Toast, Clover, and Lightspeed. Our onboarding team will handle the data migration - typically completed within 48 hours with zero downtime.', 1),
('How does Matbex handle offline modes?', 'Matbex uses local-first architecture. All critical operations (sales, clock-ins, inventory counts) work offline and sync automatically when connectivity is restored. Your restaurant never stops, even if the internet does.', 2),
('Is my data encrypted?', 'Absolutely. We use AES-256 encryption at rest and TLS 1.3 in transit. Your data is stored in SOC 2 Type II certified data centers with daily backups. We are also GDPR and CCPA compliant.', 3),
('What kind of support do you offer?', 'Essentials plans include email support with 24-hour response times. Pro plans get priority support with live chat during business hours. Enterprise customers receive a dedicated account manager and 24/7 phone support.', 4),
('Can I try before I buy?', 'Yes! Every plan includes a 14-day free trial with full feature access. No credit card required to start. If you need more time to evaluate, just reach out - we are flexible.', 5),
('How accurate is the COGS tracking?', 'Our customers typically see theoretical vs. actual variance within 0.5%. The system tracks every ingredient from receiving to plate, accounting for waste, comps, and portion variations. Most operators identify 3-5% in hidden costs within the first month.', 6);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_landing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add update triggers
CREATE TRIGGER update_landing_hero_updated_at BEFORE UPDATE ON public.landing_hero FOR EACH ROW EXECUTE FUNCTION public.update_landing_updated_at();
CREATE TRIGGER update_landing_features_updated_at BEFORE UPDATE ON public.landing_features FOR EACH ROW EXECUTE FUNCTION public.update_landing_updated_at();
CREATE TRIGGER update_landing_testimonials_updated_at BEFORE UPDATE ON public.landing_testimonials FOR EACH ROW EXECUTE FUNCTION public.update_landing_updated_at();
CREATE TRIGGER update_landing_pricing_updated_at BEFORE UPDATE ON public.landing_pricing_plans FOR EACH ROW EXECUTE FUNCTION public.update_landing_updated_at();
CREATE TRIGGER update_landing_faq_updated_at BEFORE UPDATE ON public.landing_faq FOR EACH ROW EXECUTE FUNCTION public.update_landing_updated_at();