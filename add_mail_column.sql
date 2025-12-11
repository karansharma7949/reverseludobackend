-- Add mail column to users table if it doesn't exist
-- Run this in Supabase SQL Editor

-- Add mail column (stores user's mailbox messages)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mail JSONB DEFAULT '[]';

-- Example mail structure:
-- [
--   {
--     "id": "1234567890",
--     "type": "gift",
--     "title": "🎁 You received a gift!",
--     "content": "You've been gifted a Golden Dice! Check your inventory.",
--     "timestamp": "2024-12-07T10:30:00.000Z",
--     "seen": false
--   }
-- ]

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name = 'mail';
