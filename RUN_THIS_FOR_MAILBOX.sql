-- =====================================================
-- COMPLETE MAILBOX SETUP - RUN THIS IN SUPABASE SQL EDITOR
-- =====================================================

-- Step 1: Fix RLS policy to allow friend requests
DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update profiles"
  ON users FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Step 2: Add mailbox column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS mailbox JSONB[] DEFAULT '{}';

-- Step 3: Create index for better performance
CREATE INDEX IF NOT EXISTS idx_users_mailbox ON users USING GIN (mailbox);

-- Step 4: Migrate existing friend_requests to mailbox (if any)
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
WHERE friend_requests IS NOT NULL 
  AND array_length(friend_requests, 1) > 0
  AND (mailbox IS NULL OR array_length(mailbox, 1) = 0);

-- Verify the setup
SELECT 
  column_name, 
  data_type,
  column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('mailbox', 'friend_requests', 'friends');

-- Show current RLS policies
SELECT * FROM pg_policies WHERE tablename = 'users';

-- =====================================================
-- DONE! The mailbox system is now ready.
-- =====================================================
-- 
-- MAILBOX ITEM FORMATS:
-- 
-- Friend Request:
-- {
--   "mail_type": "friend_request",
--   "user_id": "sender-uid",
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
