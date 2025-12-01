-- Migration Script: Convert players column from UUID[] to JSONB
-- This updates the existing game_rooms table to use color assignments

-- Step 1: Drop the RLS policy that depends on players column
DROP POLICY IF EXISTS "Host and players can update game room" ON game_rooms;

-- Step 2: Add a temporary column for the new JSONB structure
ALTER TABLE game_rooms ADD COLUMN players_new JSONB DEFAULT '{}';

-- Step 3: Migrate existing data (if any rows exist)
-- Convert array of UUIDs to JSONB object with color assignments
UPDATE game_rooms
SET players_new = (
  SELECT jsonb_object_agg(
    player_id,
    CASE 
      WHEN row_num = 1 THEN 'red'
      WHEN row_num = 2 THEN 'blue'
      WHEN row_num = 3 THEN 'green'
      WHEN row_num = 4 THEN 'yellow'
    END
  )
  FROM (
    SELECT 
      unnest(players) as player_id,
      ROW_NUMBER() OVER () as row_num
  ) as numbered_players
)
WHERE players IS NOT NULL AND array_length(players, 1) > 0;

-- Step 4: Drop the old players column
ALTER TABLE game_rooms DROP COLUMN players;

-- Step 5: Rename the new column to players
ALTER TABLE game_rooms RENAME COLUMN players_new TO players;

-- Step 6: Recreate the RLS policy with updated logic for JSONB
CREATE POLICY "Host and players can update game room"
  ON game_rooms FOR UPDATE
  USING (
    auth.uid() = host_id OR 
    (players ? auth.uid()::text)  -- Check if user's UID exists as key in JSONB
  );

-- Step 7: Update the comment
COMMENT ON COLUMN game_rooms.players IS 'JSON object mapping player UID to assigned color: {"user_uuid": "red", "user2_uuid": "blue"}';

-- Verify the migration
SELECT 
  room_id, 
  players,
  jsonb_typeof(players) as players_type
FROM game_rooms
LIMIT 5;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Players column is now JSONB with color assignments.';
  RAISE NOTICE 'RLS policy has been recreated with JSONB support.';
END $$;
