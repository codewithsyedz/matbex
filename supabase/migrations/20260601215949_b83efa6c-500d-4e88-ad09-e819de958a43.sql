ALTER TABLE public.promotion_campaigns
  ADD COLUMN IF NOT EXISTS badge_label_ar text,
  ADD COLUMN IF NOT EXISTS headline_ar text,
  ADD COLUMN IF NOT EXISTS subheadline_ar text,
  ADD COLUMN IF NOT EXISTS perks_ar jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.promotion_campaigns
SET
  badge_label_ar = COALESCE(badge_label_ar, 'مجموعة التأسيس 50'),
  headline_ar = COALESCE(headline_ar, 'خصم 50% في السنة الأولى. و25% مدى الحياة.'),
  subheadline_ar = COALESCE(subheadline_ar, 'أول 50 مطعمًا يحصلون على نصف سعر باقة النمو لمدة 12 شهرًا، ثم يحتفظون بخصم 25% مدى الحياة. بالإضافة إلى نقل البيانات مجانًا، وخط واتساب مباشر مع المؤسس، وعرض شعار مطعمك على جدار "موثوق به من".')
WHERE name = 'Founding 50 — Launch Cohort';