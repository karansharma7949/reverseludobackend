-- =====================================================
-- INVENTORY DATA VERIFICATION SCRIPT
-- Run this to check if your inventory data is correct
-- =====================================================

-- 1. Check all items in inventory
SELECT 
    item_id,
    item_name,
    item_type,
    item_price,
    item_images
FROM inventory
ORDER BY item_type, item_price;

-- 2. Check specifically token items
SELECT 
    item_id,
    item_name,
    item_type,
    item_images
FROM inventory
WHERE item_type = 'token';

-- 3. Validate JSON structure of item_images
-- This will fail if JSON is invalid
SELECT 
    item_id,
    item_name,
    item_type,
    item_images::jsonb as parsed_images
FROM inventory
WHERE item_type = 'token';

-- 4. Check token color keys
SELECT 
    item_id,
    item_name,
    jsonb_object_keys(item_images::jsonb) as color_keys
FROM inventory
WHERE item_type = 'token';

-- 5. Check user's owned items and selected styles
SELECT 
    id,
    username,
    owned_items,
    selected_dice_style,
    selected_board_style,
    selected_token_style
FROM users
LIMIT 10;

-- 6. Check for NULL or empty item_images
SELECT 
    item_id,
    item_name,
    item_type,
    CASE 
        WHEN item_images IS NULL THEN 'NULL'
        WHEN item_images::text = '' THEN 'EMPTY'
        WHEN item_images::text = '{}' THEN 'EMPTY OBJECT'
        ELSE 'OK'
    END as status
FROM inventory
WHERE item_images IS NULL 
   OR item_images::text = '' 
   OR item_images::text = '{}';

-- 7. Verify all token items have at least one color
SELECT 
    item_id,
    item_name,
    CASE 
        WHEN item_images::jsonb ? 'blue' THEN 'Has blue'
        WHEN item_images::jsonb ? 'red' THEN 'Has red'
        WHEN item_images::jsonb ? 'green' THEN 'Has green'
        WHEN item_images::jsonb ? 'yellow' THEN 'Has yellow'
        ELSE 'NO COLORS FOUND!'
    END as color_status
FROM inventory
WHERE item_type = 'token';

-- 8. Check URL format in token images
SELECT 
    item_id,
    item_name,
    item_images::jsonb->>'blue' as blue_url,
    item_images::jsonb->>'red' as red_url,
    item_images::jsonb->>'green' as green_url,
    item_images::jsonb->>'yellow' as yellow_url
FROM inventory
WHERE item_type = 'token';

-- =====================================================
-- SAMPLE CORRECT DATA FOR TOKENS
-- =====================================================

-- Example of correct token item_images structure:
/*
{
  "blue": "https://your-project.supabase.co/storage/v1/object/public/items/tokens/classic_blue.png",
  "red": "https://your-project.supabase.co/storage/v1/object/public/items/tokens/classic_red.png",
  "green": "https://your-project.supabase.co/storage/v1/object/public/items/tokens/classic_green.png",
  "yellow": "https://your-project.supabase.co/storage/v1/object/public/items/tokens/classic_yellow.png"
}
*/

-- =====================================================
-- FIX SCRIPTS (if needed)
-- =====================================================

-- Fix NULL item_images (replace with empty object)
-- UPDATE inventory 
-- SET item_images = '{}'::jsonb
-- WHERE item_images IS NULL;

-- Fix owned_items if it's not an array
-- UPDATE users
-- SET owned_items = '[]'::text[]
-- WHERE owned_items IS NULL;

-- Add default token if user has none selected
-- UPDATE users
-- SET selected_token_style = 'token_classic'
-- WHERE selected_token_style IS NULL;
