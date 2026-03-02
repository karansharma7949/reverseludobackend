-- Simple version without policies (run this if the main script fails)

-- Create inventory table for storing purchasable items
CREATE TABLE IF NOT EXISTS inventory (
  item_id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('dice', 'board', 'token')),
  item_images JSONB NOT NULL,
  item_price INTEGER NOT NULL CHECK (item_price >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries by item type
CREATE INDEX IF NOT EXISTS idx_inventory_item_type ON inventory(item_type);

-- Add some default/classic items with multiple image variants
INSERT INTO inventory (item_id, item_name, item_type, item_images, item_price) VALUES
  -- DICE
  ('classic_dice', 'Classic Dice', 'dice', 
   '{"thumbnail": "https://your-supabase-url/storage/v1/object/public/items/dice/classic_thumb.png",
     "preview": "https://your-supabase-url/storage/v1/object/public/items/dice/classic_preview.png",
     "idle": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dicebuttonImage.png",
     "frame_01": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/01.png",
     "frame_02": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/02.png",
     "frame_03": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/03.png",
     "frame_04": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/04.png",
     "frame_05": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/05.png",
     "frame_06": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/06.png",
     "frame_07": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/07.png",
     "frame_08": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/08.png",
     "frame_09": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/09.png",
     "frame_10": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/10.png",
     "frame_11": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/11.png",
     "frame_12": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/12.png",
     "frame_13": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/13.png",
     "frame_14": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/14.png",
     "frame_15": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/15.png",
     "dice1": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice1.png",
     "dice2": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice2.png",
     "dice3": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice3.png",
     "dice4": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice4.png",
     "dice5": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice5.png",
     "dice6": "https://your-supabase-url/storage/v1/object/public/items/dice/classic/dice6.png"}'::jsonb, 
   0),
  -- BOARD
  ('classic_board', 'Classic Board', 'board', 
   '{"thumbnail": "https://your-supabase-url/storage/v1/object/public/items/boards/classic_thumb.png",
     "preview": "https://your-supabase-url/storage/v1/object/public/items/boards/classic_preview.png",
     "board": "https://your-supabase-url/storage/v1/object/public/items/boards/classic/classicludoboard.png"}'::jsonb, 
   0),
  -- TOKEN
  ('classic_token', 'Classic Token', 'token', 
   '{"thumbnail": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic_thumb.png",
     "preview": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic_preview.png",
     "red": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic/redtoken.png",
     "blue": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic/bluetoken.png",
     "green": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic/greentoken.png",
     "yellow": "https://your-supabase-url/storage/v1/object/public/items/tokens/classic/yellowtoken.png"}'::jsonb, 
   0)
ON CONFLICT (item_id) DO NOTHING;
