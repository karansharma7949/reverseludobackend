-- =====================================================
-- SIMPLE FIX - ADD INVENTORY COLUMNS TO USERS TABLE
-- Copy and paste this entire script into Supabase SQL Editor
-- =====================================================

-- Add the missing columns
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS owned_items text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS selected_dice_style text,
ADD COLUMN IF NOT EXISTS selected_board_style text,
ADD COLUMN IF NOT EXISTS selected_token_style text;

-- Initialize existing users
UPDATE users 
SET owned_items = '{}' 
WHERE owned_items IS NULL;

-- Verify it worked
SELECT 
    id,
    username,
    owned_items,
    selected_dice_style,
    selected_board_style,
    selected_token_style
FROM users
LIMIT 5;
