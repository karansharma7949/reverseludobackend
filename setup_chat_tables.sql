-- =====================================================
-- CHAT SYSTEM SETUP
-- Run this SQL in Supabase SQL Editor
-- =====================================================

-- 1. Create chats table (if not exists)
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_ids TEXT[] NOT NULL,
    participant_usernames TEXT[] NOT NULL,
    last_message TEXT,
    last_message_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create chat_messages table (if not exists)
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    sender_username TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chats_participant_ids ON chats USING GIN (participant_ids);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);

-- 4. Enable RLS
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 5. Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own chats" ON chats;
DROP POLICY IF EXISTS "Users can create chats" ON chats;
DROP POLICY IF EXISTS "Users can update their own chats" ON chats;
DROP POLICY IF EXISTS "Users can view messages in their chats" ON chat_messages;
DROP POLICY IF EXISTS "Users can send messages to their chats" ON chat_messages;

-- 6. Create RLS policies for chats table
-- Cast auth.uid() to text for comparison with TEXT[] array
CREATE POLICY "Users can view their own chats"
ON chats FOR SELECT
USING (auth.uid()::text = ANY(participant_ids));

CREATE POLICY "Users can create chats"
ON chats FOR INSERT
WITH CHECK (auth.uid()::text = ANY(participant_ids));

CREATE POLICY "Users can update their own chats"
ON chats FOR UPDATE
USING (auth.uid()::text = ANY(participant_ids));

-- 7. Create RLS policies for chat_messages table
CREATE POLICY "Users can view messages in their chats"
ON chat_messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM chats
        WHERE chats.id = chat_messages.chat_id
        AND auth.uid()::text = ANY(chats.participant_ids)
    )
);

CREATE POLICY "Users can send messages to their chats"
ON chat_messages FOR INSERT
WITH CHECK (
    auth.uid()::text = sender_id
    AND EXISTS (
        SELECT 1 FROM chats
        WHERE chats.id = chat_messages.chat_id
        AND auth.uid()::text = ANY(chats.participant_ids)
    )
);

-- 8. Enable realtime for both tables (ignore errors if already added)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chats;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- 9. Create function to update chat's updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats
    SET updated_at = NOW(),
        last_message = NEW.message,
        last_message_time = NEW.created_at
    WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Create trigger to auto-update chat when message is sent
DROP TRIGGER IF EXISTS on_message_sent ON chat_messages;
CREATE TRIGGER on_message_sent
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_timestamp();

-- =====================================================
-- SUCCESS! Tables and policies created.
-- =====================================================
