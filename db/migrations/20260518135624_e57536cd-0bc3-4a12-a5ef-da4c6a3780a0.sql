-- Add unique constraint on tenant slug to prevent duplicates
ALTER TABLE public.tenants 
ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);

-- Also ensure empty strings are treated as NULL to avoid empty-string duplicates
CREATE OR REPLACE FUNCTION public.normalize_tenant_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug = '' THEN
    NEW.slug := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER normalize_tenant_slug_trigger
BEFORE INSERT OR UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.normalize_tenant_slug();
