-- =====================================================
-- ADD UNREAD MESSAGE TRACKING TO CHAT SYSTEM
-- Run this SQL in Supabase SQL Editor
-- =====================================================

-- 1. Add last_read_at column to chats table
-- This stores when each user last read the chat: {"user_id": "timestamp", ...}
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_read_at JSONB DEFAULT '{}'::jsonb;

-- 2. Create function to get unread count for a user in a chat
CREATE OR REPLACE FUNCTION get_unread_count(p_chat_id UUID, p_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    last_read TIMESTAMPTZ;
    unread_count INTEGER;
BEGIN
    -- Get when user last read this chat
    SELECT (last_read_at->>p_user_id)::timestamptz INTO last_read
    FROM chats WHERE id = p_chat_id;
    
    -- If never read, count all messages from others
    IF last_read IS NULL THEN
        SELECT COUNT(*) INTO unread_count
        FROM chat_messages
        WHERE chat_id = p_chat_id AND sender_id != p_user_id;
    ELSE
        -- Count messages from others after last read
        SELECT COUNT(*) INTO unread_count
        FROM chat_messages
        WHERE chat_id = p_chat_id 
        AND sender_id != p_user_id 
        AND created_at > last_read;
    END IF;
    
    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to mark chat as read
CREATE OR REPLACE FUNCTION mark_chat_as_read(p_chat_id UUID, p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE chats
    SET last_read_at = COALESCE(last_read_at, '{}'::jsonb) || jsonb_build_object(p_user_id, NOW()::text)
    WHERE id = p_chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant access to the functions
GRANT EXECUTE ON FUNCTION get_unread_count(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_chat_as_read(UUID, TEXT) TO authenticated;

-- =====================================================
-- DONE! Unread tracking is now available.
-- 
-- Usage from Flutter:
-- - Get unread count: supabase.rpc('get_unread_count', params: {'p_chat_id': chatId, 'p_user_id': userId})
-- - Mark as read: supabase.rpc('mark_chat_as_read', params: {'p_chat_id': chatId, 'p_user_id': userId})
-- =====================================================
