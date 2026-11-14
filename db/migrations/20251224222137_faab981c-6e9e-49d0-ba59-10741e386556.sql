-- Add VAT percentage column to inventory_items table
ALTER TABLE public.inventory_items 
ADD COLUMN vat_percentage numeric NOT NULL DEFAULT 15;

-- Add comment for clarity
COMMENT ON COLUMN public.inventory_items.vat_percentage IS 'VAT percentage applied to this inventory item';