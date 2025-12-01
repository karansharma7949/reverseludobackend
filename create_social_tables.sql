-- =====================================================
-- SOCIAL SYSTEM DATABASE SETUP
-- =====================================================

-- 1. Add social columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS chat_ids text[] DEFAULT '{}';

-- 2. Create chats table for storing chat metadata  
CREATE TABLE IF NOT EXISTS chats (
    id text PRIMARY KEY,
    participant_ids uuid[] NOT NULL,
    participant_usernames text[] NOT NULL,
    last_message text,
    last_message_time timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Create chat_messages table for storing individual messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_username text NOT NULL,
    message text NOT NULL,
    created_at timestamptz DEFAULT now(),
    is_read boolean DEFAULT false
);

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chats_participant_ids ON chats USING GIN (participant_ids);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_friends ON users USING GIN (friends);
CREATE INDEX IF NOT EXISTS idx_users_friend_requests ON users USING GIN (friend_requests);

-- 5. Enable Row Level Security
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS Policies for chats table
CREATE POLICY "Users can view their own chats"
    ON chats FOR SELECT
    USING (auth.uid() = ANY(participant_ids));

CREATE POLICY "Users can create chats"
    ON chats FOR INSERT
    WITH CHECK (auth.uid() = ANY(participant_ids));

CREATE POLICY "Users can update their own chats"
    ON chats FOR UPDATE
    USING (auth.uid() = ANY(participant_ids));

-- 7. Create RLS Policies for chat_messages table
CREATE POLICY "Users can view messages in their chats"
    ON chat_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chats 
            WHERE chats.id = chat_messages.chat_id 
            AND auth.uid() = ANY(chats.participant_ids)
        )
    );

CREATE POLICY "Users can send messages to their chats"
    ON chat_messages FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id AND
        EXISTS (
            SELECT 1 FROM chats 
            WHERE chats.id = chat_messages.chat_id 
            AND auth.uid() = ANY(chats.participant_ids)
        )
    );

CREATE POLICY "Users can update their own messages"
    ON chat_messages FOR UPDATE
    USING (auth.uid() = sender_id);

-- 8. Create function to update chat's last message
CREATE OR REPLACE FUNCTION update_chat_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats
    SET 
        last_message = NEW.message,
        last_message_time = NEW.created_at,
        updated_at = now()
    WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger for updating last message
DROP TRIGGER IF EXISTS trigger_update_chat_last_message ON chat_messages;
CREATE TRIGGER trigger_update_chat_last_message
    AFTER INSERT ON chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_last_message();

-- 10. Enable Realtime for chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chats;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get or create chat between two users
CREATE OR REPLACE FUNCTION get_or_create_chat(
    user1_id uuid,
    user2_id uuid,
    user1_username text,
    user2_username text
)
RETURNS text AS $$
DECLARE
    chat_id_result text;
    existing_chat_id text;
BEGIN
    -- Check if chat already exists
    SELECT id INTO existing_chat_id
    FROM chats
    WHERE participant_ids @> ARRAY[user1_id, user2_id]
    AND participant_ids <@ ARRAY[user1_id, user2_id];
    
    IF existing_chat_id IS NOT NULL THEN
        RETURN existing_chat_id;
    END IF;
    
    -- Create new chat ID
    chat_id_result := user1_id::text || '_' || user2_id::text;
    
    -- Insert new chat
    INSERT INTO chats (id, participant_ids, participant_usernames)
    VALUES (
        chat_id_result,
        ARRAY[user1_id, user2_id],
        ARRAY[user1_username, user2_username]
    );
    
    -- Add chat_id to both users
    UPDATE users SET chat_ids = array_append(chat_ids, chat_id_result)
    WHERE id = user1_id AND NOT (chat_ids @> ARRAY[chat_id_result]);
    
    UPDATE users SET chat_ids = array_append(chat_ids, chat_id_result)
    WHERE id = user2_id AND NOT (chat_ids @> ARRAY[chat_id_result]);
    
    RETURN chat_id_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE chats IS 'Stores chat metadata between users';
COMMENT ON TABLE chat_messages IS 'Stores individual chat messages';
COMMENT ON COLUMN users.friends IS 'Array of friend user IDs';
COMMENT ON COLUMN users.friend_requests IS 'Array of pending friend request user IDs';
COMMENT ON COLUMN users.chat_ids IS 'Array of chat IDs user is part of';
