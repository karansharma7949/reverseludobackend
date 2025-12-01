-- Add room_type column to distinguish between online and friend modes
ALTER TABLE game_rooms 
ADD COLUMN IF NOT EXISTS room_type VARCHAR(20) DEFAULT 'online' 
CHECK (room_type IN ('online', 'friend'));

-- Update no_of_players constraint to allow 4, 5, 6 players for friend mode
ALTER TABLE game_rooms 
DROP CONSTRAINT IF EXISTS game_rooms_no_of_players_check;

ALTER TABLE game_rooms 
ADD CONSTRAINT game_rooms_no_of_players_check 
CHECK (no_of_players IN (2, 3, 4, 5, 6));

-- Add comment
COMMENT ON COLUMN game_rooms.room_type IS 'Type of room: online (quick match) or friend (private room with code)';
