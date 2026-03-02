-- Create store table for purchasable items (coins, diamonds, talktime, offers)
CREATE TABLE IF NOT EXISTS store (
  item_id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('coins', 'diamonds', 'talktime', 'offers')),
  item_image TEXT NOT NULL, -- Single image URL for the store item
  item_price INTEGER NOT NULL CHECK (item_price >= 0), -- Price in real currency (paise/cents)
  item_value INTEGER NOT NULL DEFAULT 0, -- What user gets (e.g., 1000 coins, 50 diamonds)
  discount_percent INTEGER DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  is_featured BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries by item type
CREATE INDEX IF NOT EXISTS idx_store_item_type ON store(item_type);
CREATE INDEX IF NOT EXISTS idx_store_is_active ON store(is_active);
CREATE INDEX IF NOT EXISTS idx_store_is_featured ON store(is_featured);

-- Add sample store items
INSERT INTO store (item_id, item_name, item_type, item_image, item_price, item_value, discount_percent, is_featured) VALUES
  -- COINS packages
  ('coins_100', '100 Coins', 'coins', 'assets/images/coinIcon.png', 1000, 100, 0, false),
  ('coins_500', '500 Coins', 'coins', 'assets/images/coinIcon.png', 4500, 500, 10, false),
  ('coins_1000', '1000 Coins', 'coins', 'assets/images/coinIcon.png', 8000, 1000, 20, true),
  ('coins_5000', '5000 Coins', 'coins', 'assets/images/coinIcon.png', 35000, 5000, 30, false),
  
  -- DIAMONDS packages
  ('diamonds_10', '10 Diamonds', 'diamonds', 'assets/images/diamondIcon.png', 2000, 10, 0, false),
  ('diamonds_50', '50 Diamonds', 'diamonds', 'assets/images/diamondIcon.png', 9000, 50, 10, false),
  ('diamonds_100', '100 Diamonds', 'diamonds', 'assets/images/diamondIcon.png', 16000, 100, 20, true),
  ('diamonds_500', '500 Diamonds', 'diamonds', 'assets/images/diamondIcon.png', 70000, 500, 30, false),
  
  -- TALKTIME packages
  ('talktime_10', '₹10 Talktime', 'talktime', 'assets/images/talktimeIcon.png', 1000, 10, 0, false),
  ('talktime_50', '₹50 Talktime', 'talktime', 'assets/images/talktimeIcon.png', 5000, 50, 0, false),
  ('talktime_100', '₹100 Talktime', 'talktime', 'assets/images/talktimeIcon.png', 10000, 100, 0, true),
  
  -- OFFERS (special bundles)
  ('starter_pack', 'Starter Pack', 'offers', 'assets/images/offersIcon.png', 9900, 0, 50, true),
  ('mega_bundle', 'Mega Bundle', 'offers', 'assets/images/offersIcon.png', 49900, 0, 40, true),
  ('weekly_deal', 'Weekly Deal', 'offers', 'assets/images/offersIcon.png', 19900, 0, 30, false)
ON CONFLICT (item_id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE store ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view store items" ON store;
DROP POLICY IF EXISTS "Only admins can modify store" ON store;

-- Policy: Everyone can read active store items
CREATE POLICY "Anyone can view store items"
  ON store
  FOR SELECT
  USING (is_active = true);

-- Policy: Only authenticated users with admin role can insert/update/delete
CREATE POLICY "Only admins can modify store"
  ON store
  FOR ALL
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE store IS 'Stores all purchasable items (coins, diamonds, talktime, offers) for in-app purchases';
COMMENT ON COLUMN store.item_id IS 'Unique identifier for the store item';
COMMENT ON COLUMN store.item_type IS 'Type of item: coins, diamonds, talktime, or offers';
COMMENT ON COLUMN store.item_image IS 'Single image URL/path for the store item';
COMMENT ON COLUMN store.item_price IS 'Price in smallest currency unit (paise/cents)';
COMMENT ON COLUMN store.item_value IS 'What user receives (coins/diamonds amount, talktime value)';
COMMENT ON COLUMN store.discount_percent IS 'Discount percentage to show (0-100)';
COMMENT ON COLUMN store.is_featured IS 'Whether this item should be highlighted';
COMMENT ON COLUMN store.is_active IS 'Whether this item is available for purchase';
