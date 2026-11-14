
-- Sync `is_superadmin` claim into auth.users.raw_app_meta_data so it is
-- automatically embedded in every JWT (under `app_metadata.is_superadmin`).
-- The trigger lives on a public table (superadmin_users) - only the data of
-- auth.users is updated, not its schema.

CREATE OR REPLACE FUNCTION public.sync_superadmin_jwt_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_user uuid;
  still_superadmin boolean;
BEGIN
  target_user := COALESCE(NEW.user_id, OLD.user_id);

  SELECT EXISTS (
    SELECT 1 FROM public.superadmin_users WHERE user_id = target_user
  ) INTO still_superadmin;

  UPDATE auth.users
     SET raw_app_meta_data =
           COALESCE(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('is_superadmin', still_superadmin)
   WHERE id = target_user;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_superadmin_jwt_ins ON public.superadmin_users;
DROP TRIGGER IF EXISTS trg_sync_superadmin_jwt_del ON public.superadmin_users;

CREATE TRIGGER trg_sync_superadmin_jwt_ins
AFTER INSERT OR UPDATE ON public.superadmin_users
FOR EACH ROW EXECUTE FUNCTION public.sync_superadmin_jwt_claim();

CREATE TRIGGER trg_sync_superadmin_jwt_del
AFTER DELETE ON public.superadmin_users
FOR EACH ROW EXECUTE FUNCTION public.sync_superadmin_jwt_claim();

-- Backfill existing rows: stamp current SuperAdmins, clear the claim on everyone else.
UPDATE auth.users
   SET raw_app_meta_data =
         COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('is_superadmin', true)
 WHERE id IN (SELECT user_id FROM public.superadmin_users);

UPDATE auth.users
   SET raw_app_meta_data =
         COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('is_superadmin', false)
 WHERE id NOT IN (SELECT user_id FROM public.superadmin_users)
   AND COALESCE((raw_app_meta_data ->> 'is_superadmin')::boolean, false) = true;
