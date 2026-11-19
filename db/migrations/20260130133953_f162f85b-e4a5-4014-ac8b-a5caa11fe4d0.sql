-- ============================================================
-- COMPREHENSIVE RESTAURANT CHART OF ACCOUNTS
-- Drop and recreate the ensure_standard_coa_accounts function
-- with all restaurant-specific accounts
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_standard_coa_accounts(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  -- Insert comprehensive restaurant-specific accounts if they don't exist
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    -- ============================================================
    -- ASSET ACCOUNTS (1000-1999)
    -- ============================================================
    -- Cash & Bank
    (p_tenant_id, '1000', 'Cash on Hand', 'asset', 'Physical cash in registers and safes', true),
    (p_tenant_id, '1010', 'Bank Account - Primary', 'asset', 'Primary operating bank account', true),
    (p_tenant_id, '1020', 'Bank Account - Savings', 'asset', 'Business savings account', true),
    (p_tenant_id, '1030', 'Petty Cash', 'asset', 'Small cash fund for minor expenses', true),
    
    -- Receivables
    (p_tenant_id, '1100', 'Accounts Receivable', 'asset', 'Money owed by credit customers', true),
    (p_tenant_id, '1110', 'Accounts Receivable - Delivery Platforms', 'asset', 'Receivables from Talabat, Careem, etc.', true),
    (p_tenant_id, '1120', 'Accounts Receivable - Corporate', 'asset', 'Receivables from corporate clients', true),
    (p_tenant_id, '1150', 'Employee Advances Receivable', 'asset', 'Salary advances given to employees', true),
    (p_tenant_id, '1160', 'Security Deposits', 'asset', 'Deposits paid for utilities, rent, equipment', true),
    
    -- Inventory
    (p_tenant_id, '1200', 'Inventory - Food', 'asset', 'Food ingredients and raw materials', true),
    (p_tenant_id, '1210', 'Inventory - Beverages', 'asset', 'Soft drinks, juices, water', true),
    (p_tenant_id, '1220', 'Inventory - Packaging', 'asset', 'Takeaway containers, bags, utensils', true),
    (p_tenant_id, '1230', 'Inventory - Cleaning Supplies', 'asset', 'Cleaning materials and chemicals', true),
    (p_tenant_id, '1240', 'Inventory - Consumables', 'asset', 'Napkins, straws, condiments', true),
    
    -- Prepaid Expenses
    (p_tenant_id, '1300', 'Prepaid Rent', 'asset', 'Rent paid in advance', true),
    (p_tenant_id, '1310', 'Prepaid Insurance', 'asset', 'Insurance premiums paid in advance', true),
    (p_tenant_id, '1320', 'Prepaid Licenses', 'asset', 'Trade licenses and permits paid in advance', true),
    
    -- Fixed Assets
    (p_tenant_id, '1500', 'Kitchen Equipment', 'asset', 'Ovens, grills, fryers, refrigerators', true),
    (p_tenant_id, '1510', 'Furniture & Fixtures', 'asset', 'Tables, chairs, décor items', true),
    (p_tenant_id, '1520', 'POS & Technology Equipment', 'asset', 'POS terminals, computers, printers', true),
    (p_tenant_id, '1530', 'Vehicles', 'asset', 'Delivery vehicles', true),
    (p_tenant_id, '1540', 'Leasehold Improvements', 'asset', 'Build-out and renovation costs', true),
    (p_tenant_id, '1600', 'Accumulated Depreciation - Equipment', 'asset', 'Accumulated depreciation on equipment', true),
    (p_tenant_id, '1610', 'Accumulated Depreciation - Furniture', 'asset', 'Accumulated depreciation on furniture', true),
    (p_tenant_id, '1620', 'Accumulated Depreciation - Vehicles', 'asset', 'Accumulated depreciation on vehicles', true),

    -- ============================================================
    -- LIABILITY ACCOUNTS (2000-2999)
    -- ============================================================
    -- Payables
    (p_tenant_id, '2000', 'Accounts Payable', 'liability', 'Money owed to suppliers', true),
    (p_tenant_id, '2010', 'Accounts Payable - Food Suppliers', 'liability', 'Payables to food vendors', true),
    (p_tenant_id, '2020', 'Accounts Payable - Beverage Suppliers', 'liability', 'Payables to beverage vendors', true),
    (p_tenant_id, '2030', 'Accounts Payable - Packaging Suppliers', 'liability', 'Payables to packaging vendors', true),
    (p_tenant_id, '2100', 'Accrued Expenses', 'liability', 'Expenses incurred but not yet paid', true),
    (p_tenant_id, '2110', 'Accrued Salaries', 'liability', 'Salaries earned by employees but not yet paid', true),
    (p_tenant_id, '2120', 'Accrued Rent', 'liability', 'Rent owed but not yet paid', true),
    (p_tenant_id, '2130', 'Accrued Utilities', 'liability', 'Utility bills pending payment', true),
    
    -- Tax Liabilities
    (p_tenant_id, '2200', 'VAT Payable', 'liability', 'Value Added Tax collected from customers', true),
    (p_tenant_id, '2210', 'Service Charge Payable', 'liability', 'Service charges collected to be distributed', true),
    (p_tenant_id, '2220', 'Withholding Tax Payable', 'liability', 'Tax withheld from employee salaries', true),
    
    -- Other Liabilities
    (p_tenant_id, '2300', 'Customer Deposits', 'liability', 'Deposits received for catering/events', true),
    (p_tenant_id, '2310', 'Gift Cards Liability', 'liability', 'Unredeemed gift card balances', true),
    (p_tenant_id, '2400', 'Short-term Loans', 'liability', 'Bank loans due within one year', true),
    (p_tenant_id, '2500', 'Long-term Loans', 'liability', 'Bank loans due after one year', true),

    -- ============================================================
    -- EQUITY ACCOUNTS (3000-3999)
    -- ============================================================
    (p_tenant_id, '3000', 'Owner Capital', 'equity', 'Initial and additional capital invested', true),
    (p_tenant_id, '3100', 'Owner Drawings', 'equity', 'Withdrawals by owner', true),
    (p_tenant_id, '3200', 'Retained Earnings', 'equity', 'Accumulated profits from prior periods', true),
    (p_tenant_id, '3300', 'Current Year Earnings', 'equity', 'Net income for current fiscal year', true),

    -- ============================================================
    -- REVENUE ACCOUNTS (4000-4999)
    -- ============================================================
    -- Sales Revenue
    (p_tenant_id, '4000', 'Food Sales - Dine-in', 'revenue', 'Revenue from dine-in food orders', true),
    (p_tenant_id, '4010', 'Food Sales - Takeaway', 'revenue', 'Revenue from takeaway orders', true),
    (p_tenant_id, '4020', 'Food Sales - Delivery', 'revenue', 'Revenue from delivery orders', true),
    (p_tenant_id, '4100', 'Beverage Sales', 'revenue', 'Revenue from beverage sales', true),
    (p_tenant_id, '4200', 'Catering Revenue', 'revenue', 'Revenue from catering services', true),
    (p_tenant_id, '4300', 'Delivery Platform Fees Collected', 'revenue', 'Fees collected from delivery platforms', true),
    
    -- Other Revenue
    (p_tenant_id, '4500', 'Service Charge Revenue', 'revenue', 'Service charge portion retained by restaurant', true),
    (p_tenant_id, '4600', 'Discounts & Promotions', 'revenue', 'Contra-revenue for discounts (negative)', true),
    (p_tenant_id, '4700', 'Refunds & Returns', 'revenue', 'Contra-revenue for refunds (negative)', true),
    (p_tenant_id, '4800', 'Tips Revenue', 'revenue', 'Tips collected for redistribution', true),
    (p_tenant_id, '4900', 'Other Income', 'revenue', 'Miscellaneous income', true),

    -- ============================================================
    -- COST OF GOODS SOLD (5000-5999)
    -- ============================================================
    (p_tenant_id, '5000', 'Cost of Food Sold', 'cogs', 'Cost of food ingredients consumed', true),
    (p_tenant_id, '5010', 'Cost of Beverages Sold', 'cogs', 'Cost of beverages consumed', true),
    (p_tenant_id, '5020', 'Cost of Packaging', 'cogs', 'Cost of packaging materials used', true),
    (p_tenant_id, '5100', 'Food Waste & Spoilage', 'cogs', 'Food lost to waste or spoilage', true),
    (p_tenant_id, '5110', 'Beverage Waste', 'cogs', 'Beverages lost to waste or expiry', true),
    (p_tenant_id, '5200', 'Kitchen Consumables', 'cogs', 'Cooking oil, spices, condiments used', true),
    (p_tenant_id, '5300', 'Inventory Variance', 'cogs', 'Difference between theoretical and actual inventory', true),
    (p_tenant_id, '5400', 'Purchase Discounts', 'cogs', 'Contra-COGS for supplier discounts (negative)', true),

    -- ============================================================
    -- OPERATING EXPENSE ACCOUNTS (6000-6999)
    -- ============================================================
    -- Occupancy Costs
    (p_tenant_id, '6000', 'Rent Expense', 'expense', 'Monthly rent payments', true),
    (p_tenant_id, '6010', 'Common Area Maintenance', 'expense', 'CAM charges for shared spaces', true),
    (p_tenant_id, '6020', 'Property Insurance', 'expense', 'Insurance for premises', true),
    
    -- Utilities
    (p_tenant_id, '6050', 'Electricity Expense', 'expense', 'Monthly electricity bills', true),
    (p_tenant_id, '6060', 'Water Expense', 'expense', 'Monthly water bills', true),
    (p_tenant_id, '6070', 'Gas Expense', 'expense', 'Cooking gas and LPG costs', true),
    (p_tenant_id, '6080', 'Internet & Telephone', 'expense', 'Communication expenses', true),
    
    -- Labor Costs
    (p_tenant_id, '6100', 'Salaries & Wages - Kitchen', 'expense', 'Kitchen staff salaries', true),
    (p_tenant_id, '6110', 'Salaries & Wages - Service', 'expense', 'Front-of-house staff salaries', true),
    (p_tenant_id, '6120', 'Salaries & Wages - Management', 'expense', 'Management salaries', true),
    (p_tenant_id, '6130', 'Overtime Pay', 'expense', 'Overtime wages', true),
    (p_tenant_id, '6140', 'Staff Meals', 'expense', 'Cost of staff meals provided', true),
    (p_tenant_id, '6150', 'Employee Benefits', 'expense', 'Health insurance, housing, transport allowances', true),
    (p_tenant_id, '6160', 'Visa & Labor Card Costs', 'expense', 'Employee visa and work permit expenses', true),
    (p_tenant_id, '6170', 'Staff Training', 'expense', 'Training and development costs', true),
    (p_tenant_id, '6180', 'Staff Uniforms', 'expense', 'Uniform purchase and laundry', true),
    (p_tenant_id, '6190', 'Recruitment Costs', 'expense', 'Hiring and recruitment expenses', true),
    
    -- Operating Expenses
    (p_tenant_id, '6200', 'Cleaning & Sanitation', 'expense', 'Cleaning services and supplies', true),
    (p_tenant_id, '6210', 'Pest Control', 'expense', 'Pest control services', true),
    (p_tenant_id, '6220', 'Waste Disposal', 'expense', 'Garbage and grease trap disposal', true),
    (p_tenant_id, '6230', 'Laundry & Linen', 'expense', 'Tablecloth and linen cleaning', true),
    (p_tenant_id, '6240', 'Kitchen Smallwares', 'expense', 'Pots, pans, utensils, plates', true),
    
    -- Marketing & Advertising
    (p_tenant_id, '6300', 'Marketing & Advertising', 'expense', 'General marketing expenses', true),
    (p_tenant_id, '6310', 'Social Media Marketing', 'expense', 'Paid social media campaigns', true),
    (p_tenant_id, '6320', 'Delivery Platform Commissions', 'expense', 'Commissions paid to Talabat, Careem, etc.', true),
    (p_tenant_id, '6330', 'Promotions & Discounts', 'expense', 'Cost of promotional offers', true),
    (p_tenant_id, '6340', 'Loyalty Program Costs', 'expense', 'Rewards and loyalty program expenses', true),
    (p_tenant_id, '6350', 'Printing & Stationery', 'expense', 'Menus, business cards, receipts', true),
    
    -- Technology & Software
    (p_tenant_id, '6400', 'POS Software & Subscriptions', 'expense', 'Software subscription fees', true),
    (p_tenant_id, '6410', 'Online Ordering Platform Fees', 'expense', 'Website and app maintenance', true),
    (p_tenant_id, '6420', 'IT Support & Maintenance', 'expense', 'Technical support services', true),
    
    -- Repairs & Maintenance
    (p_tenant_id, '6500', 'Equipment Repairs', 'expense', 'Kitchen equipment repairs', true),
    (p_tenant_id, '6510', 'Building Maintenance', 'expense', 'General building repairs', true),
    (p_tenant_id, '6520', 'Vehicle Maintenance', 'expense', 'Delivery vehicle repairs and fuel', true),
    (p_tenant_id, '6530', 'HVAC Maintenance', 'expense', 'Air conditioning servicing', true),
    
    -- Administrative Expenses
    (p_tenant_id, '6600', 'Accounting & Audit Fees', 'expense', 'Professional accounting services', true),
    (p_tenant_id, '6610', 'Legal Fees', 'expense', 'Legal services and consultations', true),
    (p_tenant_id, '6620', 'Bank Charges', 'expense', 'Bank fees and card processing charges', true),
    (p_tenant_id, '6630', 'License & Permit Fees', 'expense', 'Trade license, food permits, municipality fees', true),
    (p_tenant_id, '6640', 'Insurance Expense', 'expense', 'General business insurance', true),
    (p_tenant_id, '6650', 'Office Supplies', 'expense', 'General office consumables', true),
    
    -- Depreciation & Amortization
    (p_tenant_id, '6700', 'Depreciation - Kitchen Equipment', 'expense', 'Monthly depreciation of kitchen assets', true),
    (p_tenant_id, '6710', 'Depreciation - Furniture & Fixtures', 'expense', 'Monthly depreciation of furniture', true),
    (p_tenant_id, '6720', 'Depreciation - Vehicles', 'expense', 'Monthly depreciation of vehicles', true),
    (p_tenant_id, '6730', 'Amortization - Leasehold Improvements', 'expense', 'Amortization of build-out costs', true),
    
    -- Other Expenses
    (p_tenant_id, '6800', 'Entertainment & Hospitality', 'expense', 'Client entertainment expenses', true),
    (p_tenant_id, '6810', 'Travel Expenses', 'expense', 'Business travel costs', true),
    (p_tenant_id, '6820', 'Donations & Sponsorships', 'expense', 'Charitable contributions', true),
    (p_tenant_id, '6900', 'Bad Debt Expense', 'expense', 'Uncollectible customer receivables', true),
    (p_tenant_id, '6910', 'Cash Shortage', 'expense', 'Cash register discrepancies', true),
    (p_tenant_id, '6920', 'Theft & Loss', 'expense', 'Losses from theft or damage', true),
    (p_tenant_id, '6990', 'Miscellaneous Expense', 'expense', 'Other uncategorized expenses', true)
    
  ON CONFLICT (tenant_id, account_code) DO UPDATE SET
    account_name = EXCLUDED.account_name,
    description = EXCLUDED.description,
    is_system_account = true;
END;
$func$;

-- ============================================================
-- Create a function to auto-populate COA for existing tenants
-- ============================================================
CREATE OR REPLACE FUNCTION populate_coa_for_all_tenants()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    PERFORM ensure_standard_coa_accounts(v_tenant.id);
  END LOOP;
END;
$func$;

-- Run it for all existing tenants
SELECT populate_coa_for_all_tenants();

-- Clean up the helper function
DROP FUNCTION populate_coa_for_all_tenants();