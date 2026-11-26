-- Create chat channels table (for group chats)
CREATE TABLE public.chat_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create direct message conversations table
CREATE TABLE public.chat_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Participants in direct conversations
CREATE TABLE public.chat_conversation_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

-- Channel members
CREATE TABLE public.chat_channel_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

-- Messages table (for both channels and DMs)
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachment_name TEXT,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT message_target CHECK (
    (channel_id IS NOT NULL AND conversation_id IS NULL) OR
    (channel_id IS NULL AND conversation_id IS NOT NULL)
  )
);

-- Read receipts
CREATE TABLE public.chat_read_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- Enable RLS on all tables
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_read_receipts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chat_channels
CREATE POLICY "Users can view channels in their restaurant"
  ON public.chat_channels FOR SELECT
  USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Managers/owners can create channels"
  ON public.chat_channels FOR INSERT
  WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Managers/owners can update channels"
  ON public.chat_channels FOR UPDATE
  USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Managers/owners can delete channels"
  ON public.chat_channels FOR DELETE
  USING (public.can_access_restaurant(restaurant_id));

-- RLS Policies for chat_conversations
CREATE POLICY "Users can view their conversations"
  ON public.chat_conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversation_participants
      WHERE conversation_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create conversations in their restaurant"
  ON public.chat_conversations FOR INSERT
  WITH CHECK (public.can_access_restaurant(restaurant_id));

-- RLS Policies for chat_conversation_participants
CREATE POLICY "Users can view participants in their conversations"
  ON public.chat_conversation_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversation_participants cp
      WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can add participants to conversations"
  ON public.chat_conversation_participants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND public.can_access_restaurant(c.restaurant_id)
    )
  );

-- RLS Policies for chat_channel_members
CREATE POLICY "Users can view channel members"
  ON public.chat_channel_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = channel_id AND public.can_access_restaurant(c.restaurant_id)
    )
  );

CREATE POLICY "Users can join channels in their restaurant"
  ON public.chat_channel_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = channel_id AND public.can_access_restaurant(c.restaurant_id)
    )
  );

CREATE POLICY "Users can leave channels"
  ON public.chat_channel_members FOR DELETE
  USING (user_id = auth.uid());

-- RLS Policies for chat_messages
CREATE POLICY "Users can view messages in their channels/conversations"
  ON public.chat_messages FOR SELECT
  USING (
    public.can_access_restaurant(restaurant_id) AND (
      (channel_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.chat_channel_members WHERE channel_id = chat_messages.channel_id AND user_id = auth.uid()
      )) OR
      (conversation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.chat_conversation_participants WHERE conversation_id = chat_messages.conversation_id AND user_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Users can send messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    public.can_access_restaurant(restaurant_id)
  );

CREATE POLICY "Users can edit their own messages"
  ON public.chat_messages FOR UPDATE
  USING (sender_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
  ON public.chat_messages FOR DELETE
  USING (sender_id = auth.uid());

-- RLS Policies for chat_read_receipts
CREATE POLICY "Users can view read receipts"
  ON public.chat_read_receipts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = message_id AND public.can_access_restaurant(m.restaurant_id)
    )
  );

CREATE POLICY "Users can mark messages as read"
  ON public.chat_read_receipts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX idx_chat_messages_channel ON public.chat_messages(channel_id, created_at DESC);
CREATE INDEX idx_chat_messages_conversation ON public.chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_messages_restaurant ON public.chat_messages(restaurant_id);
CREATE INDEX idx_chat_read_receipts_message ON public.chat_read_receipts(message_id);
CREATE INDEX idx_chat_channel_members_user ON public.chat_channel_members(user_id);
CREATE INDEX idx_chat_conversation_participants_user ON public.chat_conversation_participants(user_id);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_read_receipts;

-- Add updated_at triggers
CREATE TRIGGER update_chat_channels_updated_at
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_chat_messages_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();