-- Create dedicated 5003 Dairy Cost COGS account for each tenant that has 5001
INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account, is_active)
SELECT DISTINCT tenant_id, '5003', 'Dairy Cost', 'cogs'::account_type,
  'Cost of dairy products consumed (milk, cheese, yogurt, butter, cream)', true, true
FROM public.chart_of_accounts
WHERE account_code = '5001'
  AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts coa2
    WHERE coa2.tenant_id = chart_of_accounts.tenant_id AND coa2.account_code = '5003'
  );

-- Re-map any existing "Dairy" expense categories to the new 5003 account
UPDATE public.expense_categories ec
SET account_id = coa.id
FROM public.chart_of_accounts coa
WHERE ec.name ILIKE 'dairy'
  AND coa.account_code = '5003'
  AND coa.tenant_id = (
    SELECT r.tenant_id FROM public.restaurants r WHERE r.id = ec.restaurant_id
  );