-- Add unique constraint on tenant name
ALTER TABLE public.tenants
ADD CONSTRAINT tenants_name_unique UNIQUE (name);

-- Add unique constraint on restaurant name within a tenant
ALTER TABLE public.restaurants
ADD CONSTRAINT restaurants_name_tenant_unique UNIQUE (tenant_id, name);