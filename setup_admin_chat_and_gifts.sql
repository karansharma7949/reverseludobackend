-- Admin Chat Tables for User Support Messages
-- Run this in Supabase SQL Editor

-- Table to store chat conversations between users and admin
CREATE TABLE IF NOT EXISTS admin_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'pending')),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  unread_by_admin BOOLEAN DEFAULT true,
  unread_by_user BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Table to store individual messages in chats
CREATE TABLE IF NOT EXISTS admin_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES admin_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to track gift history
CREATE TABLE IF NOT EXISTS gift_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gift_type TEXT NOT NULL CHECK (gift_type IN ('item', 'coins', 'diamonds')),
  item_id TEXT,
  item_name TEXT,
  amount INT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_chats_user_id ON admin_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_chats_status ON admin_chats(status);
CREATE INDEX IF NOT EXISTS idx_admin_chats_unread ON admin_chats(unread_by_admin);
CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_chat_id ON admin_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_created ON admin_chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_gift_history_user_id ON gift_history(user_id);

-- Enable RLS
ALTER TABLE admin_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for admin_chats
CREATE POLICY "Users can view their own chats" ON admin_chats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own chat" ON admin_chats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chat" ON admin_chats
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for admin_chat_messages
CREATE POLICY "Users can view messages in their chats" ON admin_chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_chats WHERE id = chat_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can send messages to their chats" ON admin_chat_messages
  FOR INSERT WITH CHECK (
    sender_type = 'user' AND
    EXISTS (SELECT 1 FROM admin_chats WHERE id = chat_id AND user_id = auth.uid())
  );

-- Service role can do everything (for admin panel)
CREATE POLICY "Service role full access to admin_chats" ON admin_chats
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to admin_chat_messages" ON admin_chat_messages
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to gift_history" ON gift_history
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Function to update chat timestamp when new message is added
CREATE OR REPLACE FUNCTION update_chat_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE admin_chats
  SET 
    last_message_at = NOW(),
    updated_at = NOW(),
    unread_by_admin = CASE WHEN NEW.sender_type = 'user' THEN true ELSE unread_by_admin END,
    unread_by_user = CASE WHEN NEW.sender_type = 'admin' THEN true ELSE unread_by_user END
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update chat on new message
DROP TRIGGER IF EXISTS trigger_update_chat_on_message ON admin_chat_messages;
CREATE TRIGGER trigger_update_chat_on_message
  AFTER INSERT ON admin_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_on_message();

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE admin_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE admin_chats;
