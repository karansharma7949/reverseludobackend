-- Convert item_images column from TEXT to JSONB
-- This preserves existing data if any

-- Step 1: Add a temporary JSONB column
ALTER TABLE inventory ADD COLUMN item_images_new JSONB;

-- Step 2: Convert existing TEXT data to JSONB (if any exists)
UPDATE inventory 
SET item_images_new = item_images::jsonb 
WHERE item_images IS NOT NULL;

-- Step 3: Drop the old TEXT column
ALTER TABLE inventory DROP COLUMN item_images;

-- Step 4: Rename the new column to item_images
ALTER TABLE inventory RENAME COLUMN item_images_new TO item_images;

-- Step 5: Make it NOT NULL
ALTER TABLE inventory ALTER COLUMN item_images SET NOT NULL;

-- Update comment
COMMENT ON COLUMN inventory.item_images IS 'JSONB object with multiple image URLs for different contexts (thumbnail, preview, frames, colors, etc.)';
