-- Fix positions column to not have default value
-- This allows us to set positions dynamically based on active players

-- Remove default value from positions column
ALTER TABLE game_rooms 
ALTER COLUMN positions DROP DEFAULT;

-- Update existing rows to only have positions for active players
-- This is a one-time cleanup for existing data
UPDATE game_rooms
SET positions = (
  SELECT jsonb_object_agg(color, jsonb_build_object(
    'tokenA', 0,
    'tokenB', 0,
    'tokenC', 0,
    'tokenD', 0
  ))
  FROM jsonb_each_text(players) AS p(user_id, color)
)
WHERE positions IS NOT NULL;

-- Update comment
COMMENT ON COLUMN game_rooms.positions IS 'JSON object storing token positions for active player colors only';
