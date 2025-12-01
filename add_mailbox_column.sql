-- =====================================================
-- ADD MAILBOX COLUMN TO USERS TABLE
-- =====================================================
-- The mailbox column stores an array of mail items (JSONB)
-- Each mail item has:
--   - mail_type: 'friend_request' | 'general' | 'reward' | 'system'
--   - For friend_request: { mail_type, user_id, timestamp }
--   - For general: { mail_type, content, title, timestamp }
--   - For reward: { mail_type, reward_type, amount, timestamp }

-- Add mailbox column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS mailbox JSONB[] DEFAULT '{}';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_users_mailbox ON users USING GIN (mailbox);

-- =====================================================
-- EXAMPLE MAILBOX ITEMS:
-- =====================================================
-- Friend Request:
-- {
--   "mail_type": "friend_request",
--   "user_id": "uuid-of-sender",
--   "timestamp": "2024-01-01T12:00:00Z"
-- }
--
-- General Mail:
-- {
--   "mail_type": "general",
--   "title": "Welcome!",
--   "content": "Welcome to Ludo Pro!",
--   "timestamp": "2024-01-01T12:00:00Z"
-- }
--
-- Reward Mail:
-- {
--   "mail_type": "reward",
--   "title": "Daily Reward",
--   "reward_type": "coins",
--   "amount": 100,
--   "claimed": false,
--   "timestamp": "2024-01-01T12:00:00Z"
-- }

-- =====================================================
-- MIGRATION: Move existing friend_requests to mailbox
-- =====================================================
-- This converts existing friend_requests array to mailbox format

UPDATE users
SET mailbox = (
  SELECT COALESCE(
    array_agg(
      jsonb_build_object(
        'mail_type', 'friend_request',
        'user_id', fr::text,
        'timestamp', NOW()
      )
    ),
    '{}'
  )
  FROM unnest(friend_requests) AS fr
)
WHERE friend_requests IS NOT NULL AND array_length(friend_requests, 1) > 0;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to add a friend request to mailbox
CREATE OR REPLACE FUNCTION add_friend_request_to_mailbox(target_uid UUID, sender_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_mail JSONB;
  current_mailbox JSONB[];
BEGIN
  -- Create the mail item
  new_mail := jsonb_build_object(
    'mail_type', 'friend_request',
    'user_id', sender_uid::text,
    'timestamp', NOW()
  );
  
  -- Get current mailbox
  SELECT mailbox INTO current_mailbox
  FROM users
  WHERE uid = target_uid;
  
  IF current_mailbox IS NULL THEN
    current_mailbox := '{}';
  END IF;
  
  -- Check if request already exists
  IF EXISTS (
    SELECT 1 FROM unnest(current_mailbox) AS m
    WHERE m->>'mail_type' = 'friend_request' 
    AND m->>'user_id' = sender_uid::text
  ) THEN
    RETURN FALSE; -- Already exists
  END IF;
  
  -- Add to mailbox
  UPDATE users
  SET mailbox = array_append(mailbox, new_mail)
  WHERE uid = target_uid;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_friend_request_to_mailbox(UUID, UUID) TO authenticated;

-- Function to add general mail to mailbox
CREATE OR REPLACE FUNCTION add_general_mail_to_mailbox(
  target_uid UUID, 
  mail_title TEXT, 
  mail_content TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_mail JSONB;
BEGIN
  new_mail := jsonb_build_object(
    'mail_type', 'general',
    'title', mail_title,
    'content', mail_content,
    'timestamp', NOW()
  );
  
  UPDATE users
  SET mailbox = array_append(mailbox, new_mail)
  WHERE uid = target_uid;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION add_general_mail_to_mailbox(UUID, TEXT, TEXT) TO authenticated;

-- Function to remove mail from mailbox by index
CREATE OR REPLACE FUNCTION remove_mail_from_mailbox(user_uid UUID, mail_index INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE users
  SET mailbox = (
    SELECT COALESCE(array_agg(m), '{}')
    FROM (
      SELECT m, row_number() OVER () - 1 AS idx
      FROM unnest(mailbox) AS m
    ) sub
    WHERE idx != mail_index
  )
  WHERE uid = user_uid;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_mail_from_mailbox(UUID, INTEGER) TO authenticated;

-- Function to remove friend request from mailbox by sender uid
CREATE OR REPLACE FUNCTION remove_friend_request_from_mailbox(user_uid UUID, sender_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE users
  SET mailbox = (
    SELECT COALESCE(array_agg(m), '{}')
    FROM unnest(mailbox) AS m
    WHERE NOT (m->>'mail_type' = 'friend_request' AND m->>'user_id' = sender_uid::text)
  )
  WHERE uid = user_uid;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_friend_request_from_mailbox(UUID, UUID) TO authenticated;

-- =====================================================
-- VERIFY
-- =====================================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'mailbox';
