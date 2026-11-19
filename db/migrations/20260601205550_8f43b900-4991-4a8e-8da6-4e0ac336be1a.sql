UPDATE public.landing_pricing_plans
SET monthly_price = 18, annual_price = 13
WHERE name = 'Starter Core' AND is_active = true;

UPDATE public.landing_pricing_plans
SET monthly_price = 53, annual_price = 40
WHERE name = 'Growth Bundle' AND is_active = true;

UPDATE public.plans
SET price = 18,
    description = 'Single-branch essentials at 69 SAR/mo (49 SAR annual). Add modules à la carte.'
WHERE name ILIKE 'Starter Core' OR name ILIKE 'free';