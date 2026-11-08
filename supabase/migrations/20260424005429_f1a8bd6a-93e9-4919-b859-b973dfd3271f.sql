-- Map all unmapped expense categories to their CoA accounts and backfill expenses

-- ============ Tenant 5abda2de (Restaurant d7370223) ============
UPDATE public.expense_categories SET account_id = '633a4031-d803-41ba-afa8-63f9809bdc30' WHERE id = 'd2376417-c23e-4dad-9be1-1920764ac35f' AND account_id IS NULL; -- Bakala -> 5000
UPDATE public.expense_categories SET account_id = '78dbabee-2161-4d15-a173-909c31076870' WHERE id = '7a999c61-3fb0-4cbb-bd2f-16f7c1e722b4' AND account_id IS NULL; -- Cylinder -> 6070
UPDATE public.expense_categories SET account_id = '61905de7-1944-458c-8852-7d40e662c9ee' WHERE id = 'd8f17949-423c-4107-ab13-78c74bc28d8a' AND account_id IS NULL; -- labour -> 6100
UPDATE public.expense_categories SET account_id = '633a4031-d803-41ba-afa8-63f9809bdc30' WHERE id = '5d25e38c-f857-4840-980d-ab45306425a3' AND account_id IS NULL; -- Market -> 5000
UPDATE public.expense_categories SET account_id = '633a4031-d803-41ba-afa8-63f9809bdc30' WHERE id = '552c5634-3ac7-47d4-bf76-e4bc74eaed8c' AND account_id IS NULL; -- Meat -> 5000
UPDATE public.expense_categories SET account_id = '633a4031-d803-41ba-afa8-63f9809bdc30' WHERE id = '1d26c2e0-b06b-447d-87f9-eaa04fc93272' AND account_id IS NULL; -- Vegie -> 5000
UPDATE public.expense_categories SET account_id = 'c3c2cb01-92e1-4572-be74-091cb6435ca0' WHERE id = '956be178-d76a-4ae4-88fa-4326e83be7e2' AND account_id IS NULL; -- Water -> 6060

-- ============ Tenant fe1a4d9e (Restaurant fe1a4d9e) ============
UPDATE public.expense_categories SET account_id = '646c6669-7e15-49ba-9e16-3bcc4bceba59' WHERE id = '021ec62c-ae1c-45ce-9a13-ff01dd007790' AND account_id IS NULL; -- Kitchen Supplies -> 5200
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = 'd15c3b84-e84b-4878-a99d-333c27e6d380' AND account_id IS NULL; -- Meat & Poultry -> 5000
UPDATE public.expense_categories SET account_id = '6b42053c-b6e3-438b-859b-2fac05b6f3c0' WHERE id = 'dc2eae8d-0801-4170-9555-acf5aefa48a8' AND account_id IS NULL; -- Packaging -> 5020
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = 'd993a781-e0a6-4ec1-b322-32c11d876fb3' AND account_id IS NULL; -- Vegetables -> 5000
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '2b3931a2-6cda-4859-aebc-4f571f34ccc0' AND account_id IS NULL; -- Vendor Payment -> 5000
-- Also map the other unmapped categories that have no expenses yet (for future use)
UPDATE public.expense_categories SET account_id = '2bbff166-3da2-4e11-9902-a7c967d7ae22' WHERE id = '84f79ab1-2ee9-44ba-9767-014a4263357b' AND account_id IS NULL; -- Beverage -> 5010
UPDATE public.expense_categories SET account_id = '646c6669-7e15-49ba-9e16-3bcc4bceba59' WHERE id = '04b6f137-38f4-4681-9fa8-64e626ded49c' AND account_id IS NULL; -- Cleaning/Kitchen Supplies -> 5200
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '13dbbd3d-afcb-49d6-b6da-7cebc07fe579' AND account_id IS NULL; -- Dairy -> 5000
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '530c9809-fc5a-4252-9548-6e5c88aee52c' AND account_id IS NULL; -- Dry Food -> 5000
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '6570d481-83da-46df-88e2-58e1552a3e19' AND account_id IS NULL; -- Ingredients -> 5000
UPDATE public.expense_categories SET account_id = 'e6b9cb51-a7e9-48a7-a3e2-4082a50ccf9f' WHERE id = 'adcd5f7b-dea6-48be-8e0b-d7cc356c8034' AND account_id IS NULL; -- Labor -> 6100
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = 'd43e0314-0e5d-47f5-8c9e-0cf4156fc0db' AND account_id IS NULL; -- Miscellaneous -> 5000
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '234f3d6a-b767-44a5-aa32-d2f5fee69b38' AND account_id IS NULL; -- Oil -> 5000
UPDATE public.expense_categories SET account_id = 'd8bf4d29-8305-48c7-99be-493e6a16b201' WHERE id = '316ae964-a184-42a2-87bf-5d962f73bbf2' AND account_id IS NULL; -- Spices -> 5000
UPDATE public.expense_categories SET account_id = '10efda15-0945-47b9-81fd-75a958a185db' WHERE id = '6735031f-8f16-4240-a430-1c8f5cd6565a' AND account_id IS NULL; -- Utilities -> 6050

-- ============ Backfill all unmapped expenses from their category mapping ============
UPDATE public.expenses e
SET account_id = ec.account_id
FROM public.expense_categories ec
WHERE e.category_id = ec.id
  AND e.account_id IS NULL
  AND ec.account_id IS NOT NULL
  AND e.deleted_at IS NULL;