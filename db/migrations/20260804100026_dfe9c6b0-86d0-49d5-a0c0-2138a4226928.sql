CREATE INDEX IF NOT EXISTS idx_sales_tx_restaurant_created_at ON public.sales_transactions (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_tx_restaurant_branch_created_at ON public.sales_transactions (restaurant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_items_restaurant_created_at ON public.sales_items (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON public.in_app_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_restaurant_status_name ON public.customers (restaurant_id, credit_status, name);
ANALYZE public.sales_transactions;
ANALYZE public.sales_items;
ANALYZE public.in_app_notifications;
ANALYZE public.customers;