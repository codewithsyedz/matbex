-- Fix the chat_conversations SELECT policy to properly reference chat_conversations.id
DROP POLICY IF EXISTS "Users can view their conversations" ON public.chat_conversations;

CREATE POLICY "Users can view their conversations"
  ON public.chat_conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversation_participants
      WHERE conversation_id = chat_conversations.id AND user_id = auth.uid()
    )
  );

-- Also fix the chat_conversation_participants policy that has the same issue
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON public.chat_conversation_participants;

CREATE POLICY "Users can view participants in their conversations"
  ON public.chat_conversation_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversation_participants AS ccp
      WHERE ccp.conversation_id = chat_conversation_participants.conversation_id 
        AND ccp.user_id = auth.uid()
    )
  );