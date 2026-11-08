-- Fix Fida's role: she works at Riyadh-HQ (fe1a4d9e) pinned to Al-Wadi branch,
-- but her user_roles row points to the legacy Al-Wadi *restaurant* (9f248794),
-- causing RLS on sales_transactions to reject her inserts.
INSERT INTO public.user_roles (user_id, restaurant_id, role)
VALUES ('d3509da4-d3cc-4b20-88dd-00f992bd9230', 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9', 'cashier')
ON CONFLICT (user_id, restaurant_id, role) DO NOTHING;

DELETE FROM public.user_roles
WHERE user_id = 'd3509da4-d3cc-4b20-88dd-00f992bd9230'
  AND restaurant_id = '9f248794-96f8-4d96-8982-110912048e12';