-- Add consecutive_sixes column to friend_rooms table
-- This column tracks consecutive 6s rolled by each player (3 consecutive 6s = turn cancelled)

ALTER TABLE friend_rooms 
ADD COLUMN IF NOT EXISTS consecutive_sixes JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN friend_rooms.consecutive_sixes IS 'JSON object tracking consecutive 6s rolled by each player: {"user_uuid": 2}';

-- Also update no_of_players constraint to allow 2 and 3 players
ALTER TABLE friend_rooms DROP CONSTRAINT IF EXISTS friend_rooms_no_of_players_check;
ALTER TABLE friend_rooms ADD CONSTRAINT friend_rooms_no_of_players_check CHECK (no_of_players >= 2 AND no_of_players <= 6);

-- Add dare column if not exists
ALTER TABLE friend_rooms 
ADD COLUMN IF NOT EXISTS dare TEXT DEFAULT NULL;

COMMENT ON COLUMN friend_rooms.dare IS 'Optional dare text that loser must perform';
