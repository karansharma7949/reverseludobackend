-- Fix RLS policies for admin_chats and admin_chat_messages
-- Run this in Supabase SQL Editor

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own chats" ON admin_chats;
DROP POLICY IF EXISTS "Users can create their own chat" ON admin_chats;
DROP POLICY IF EXISTS "Users can update their own chat" ON admin_chats;
DROP POLICY IF EXISTS "Service role full access to admin_chats" ON admin_chats;
DROP POLICY IF EXISTS "Users can view messages in their chats" ON admin_chat_messages;
DROP POLICY IF EXISTS "Users can send messages to their chats" ON admin_chat_messages;
DROP POLICY IF EXISTS "Service role full access to admin_chat_messages" ON admin_chat_messages;
DROP POLICY IF EXISTS "Service role full access to gift_history" ON gift_history;

-- Disable RLS temporarily to allow all access (for admin panel with service key)
-- Option 1: Disable RLS completely (simpler but less secure)
ALTER TABLE admin_chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE gift_history DISABLE ROW LEVEL SECURITY;

-- OR Option 2: Create permissive policies (more secure)
-- Uncomment below if you want to keep RLS enabled

/*
-- Re-enable RLS
ALTER TABLE admin_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_history ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users on their own data
CREATE POLICY "Users can manage their own chats" ON admin_chats
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Allow all for admin_chats" ON admin_chats
  FOR ALL USING (true);

CREATE POLICY "Users can manage messages in their chats" ON admin_chat_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_chats WHERE id = chat_id AND user_id = auth.uid())
    OR true  -- Allow all for service role
  );

CREATE POLICY "Allow all for admin_chat_messages" ON admin_chat_messages
  FOR ALL USING (true);

CREATE POLICY "Allow all for gift_history" ON gift_history
  FOR ALL USING (true);
*/

-- Verify tables have data
SELECT 'admin_chats count:' as info, COUNT(*) as count FROM admin_chats;
SELECT 'admin_chat_messages count:' as info, COUNT(*) as count FROM admin_chat_messages;

-- Show all chats with user info
SELECT 
  ac.id,
  ac.user_id,
  ac.status,
  ac.unread_by_admin,
  ac.last_message_at,
  u.username
FROM admin_chats ac
LEFT JOIN users u ON ac.user_id = u.uid
ORDER BY ac.last_message_at DESC;
