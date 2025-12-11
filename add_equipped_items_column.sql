-- Add equipped_items column to users table
-- Run this in Supabase SQL Editor

-- Add equipped_items column (stores which items are currently equipped by type)
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_items JSONB DEFAULT '{}';

-- Example structure:
-- {
--   "dice": "dice_123456",
--   "board": "board_789012",
--   "token": "token_345678"
-- }

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('owned_items', 'equipped_items');
