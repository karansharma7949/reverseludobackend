-- =====================================================
-- FIX INVENTORY COLUMNS IN USERS TABLE
-- Run this if you're getting "0 rows" error
-- =====================================================

-- 1. Check if columns exist
DO $$ 
BEGIN
    -- Add owned_items column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'owned_items'
    ) THEN
        ALTER TABLE users ADD COLUMN owned_items text[] DEFAULT '{}';
        RAISE NOTICE 'Added owned_items column';
    ELSE
        RAISE NOTICE 'owned_items column already exists';
    END IF;

    -- Add selected_dice_style column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'selected_dice_style'
    ) THEN
        ALTER TABLE users ADD COLUMN selected_dice_style text;
        RAISE NOTICE 'Added selected_dice_style column';
    ELSE
        RAISE NOTICE 'selected_dice_style column already exists';
    END IF;

    -- Add selected_board_style column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'selected_board_style'
    ) THEN
        ALTER TABLE users ADD COLUMN selected_board_style text;
        RAISE NOTICE 'Added selected_board_style column';
    ELSE
        RAISE NOTICE 'selected_board_style column already exists';
    END IF;

    -- Add selected_token_style column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'selected_token_style'
    ) THEN
        ALTER TABLE users ADD COLUMN selected_token_style text;
        RAISE NOTICE 'Added selected_token_style column';
    ELSE
        RAISE NOTICE 'selected_token_style column already exists';
    END IF;
END $$;

-- 2. Initialize NULL values to defaults
UPDATE users 
SET owned_items = '{}'
WHERE owned_items IS NULL;

-- 3. Verify the columns exist
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'users'
AND column_name IN (
    'owned_items',
    'selected_dice_style',
    'selected_board_style',
    'selected_token_style'
)
ORDER BY column_name;

-- 4. Check current user data
SELECT 
    id,
    username,
    owned_items,
    selected_dice_style,
    selected_board_style,
    selected_token_style
FROM users
LIMIT 5;

COMMENT ON COLUMN users.owned_items IS 'Array of item IDs that the user owns';
COMMENT ON COLUMN users.selected_dice_style IS 'Currently equipped dice style item ID';
COMMENT ON COLUMN users.selected_board_style IS 'Currently equipped board style item ID';
COMMENT ON COLUMN users.selected_token_style IS 'Currently equipped token style item ID';
