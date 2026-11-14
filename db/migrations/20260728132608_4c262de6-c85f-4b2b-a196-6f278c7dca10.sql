
CREATE TABLE IF NOT EXISTS public.pos_entity_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  checksum text,
  terminal_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_entity_versions_lookup
  ON public.pos_entity_versions (restaurant_id, entity_type, entity_id);

GRANT SELECT ON public.pos_entity_versions TO authenticated;
GRANT ALL ON public.pos_entity_versions TO service_role;

ALTER TABLE public.pos_entity_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_entity_versions read within tenant"
ON public.pos_entity_versions FOR SELECT TO authenticated
USING (can_access_restaurant(restaurant_id));
