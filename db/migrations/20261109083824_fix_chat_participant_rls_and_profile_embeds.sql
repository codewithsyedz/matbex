-- fix_chat_participant_rls_and_profile_embeds
--
-- 1) Chat: the SELECT policy on chat_conversation_participants queried the same table,
--    so every read of it (and of chat_conversations / chat_messages, whose policies read
--    it) failed with 42P17 "infinite recursion detected in policy". Check membership
--    through a SECURITY DEFINER helper instead (it reads the table without RLS).
--
-- 2) Team lists: useChat embeds profiles:user_id(...) from user_tenant_roles and
--    StaffRatesSettings does the same from user_roles. Neither table had a foreign key
--    to profiles, so PostgREST answered PGRST200 (400). Production's generated types
--    show the same gap, so this was failing there too. The keys are NOT VALID so the
--    migration cannot fail on orphaned rows; new and updated rows are checked. Run
--    VALIDATE CONSTRAINT later once orphans are cleaned up. profiles rows are deleted
--    with their auth user (cascade), so roles follow them.

-- 1) chat ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_chat_conversation_participant(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.is_chat_conversation_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_conversation_participant(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view participants in their conversations" ON public.chat_conversation_participants;
CREATE POLICY "Users can view participants in their conversations"
  ON public.chat_conversation_participants
  FOR SELECT
  USING (public.is_chat_conversation_participant(conversation_id));

-- 2) profile embeds ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tenant_roles_user_id_profiles_fkey') THEN
    ALTER TABLE public.user_tenant_roles
      ADD CONSTRAINT user_tenant_roles_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_profiles_fkey') THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
