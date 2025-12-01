-- Add inventory-related columns to users table

-- Add owned_items column (array of item_ids that user owns)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS owned_items TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add selected style columns (item_id of currently selected items)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS selected_dice_style TEXT DEFAULT NULL;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS selected_board_style TEXT DEFAULT NULL;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS selected_token_style TEXT DEFAULT NULL;

-- Add foreign key constraints to ensure selected items exist in inventory
ALTER TABLE users
ADD CONSTRAINT fk_selected_dice_style
FOREIGN KEY (selected_dice_style) 
REFERENCES inventory(item_id)
ON DELETE SET NULL;

ALTER TABLE users
ADD CONSTRAINT fk_selected_board_style
FOREIGN KEY (selected_board_style) 
REFERENCES inventory(item_id)
ON DELETE SET NULL;

ALTER TABLE users
ADD CONSTRAINT fk_selected_token_style
FOREIGN KEY (selected_token_style) 
REFERENCES inventory(item_id)
ON DELETE SET NULL;

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_users_owned_items ON users USING GIN(owned_items);
CREATE INDEX IF NOT EXISTS idx_users_selected_dice ON users(selected_dice_style);
CREATE INDEX IF NOT EXISTS idx_users_selected_board ON users(selected_board_style);
CREATE INDEX IF NOT EXISTS idx_users_selected_token ON users(selected_token_style);

-- Update existing users to have classic items by default (if they exist)
-- This gives all existing users the free classic items
UPDATE users 
SET owned_items = ARRAY['classic_dice', 'classic_board', 'classic_token']
WHERE owned_items = ARRAY[]::TEXT[] OR owned_items IS NULL;

-- Function to automatically give new users the classic items
CREATE OR REPLACE FUNCTION give_classic_items_to_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Give new users the free classic items
  NEW.owned_items := ARRAY['classic_dice', 'classic_board', 'classic_token'];
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to run the function when a new user is created
DROP TRIGGER IF EXISTS trigger_give_classic_items ON users;
CREATE TRIGGER trigger_give_classic_items
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION give_classic_items_to_new_user();

COMMENT ON COLUMN users.owned_items IS 'Array of item_ids that the user owns';
COMMENT ON COLUMN users.selected_dice_style IS 'Currently selected dice style (item_id from inventory)';
COMMENT ON COLUMN users.selected_board_style IS 'Currently selected board style (item_id from inventory)';
COMMENT ON COLUMN users.selected_token_style IS 'Currently selected token style (item_id from inventory)';
