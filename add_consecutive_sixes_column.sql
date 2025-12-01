-- Add consecutive_sixes column to track 6s rolled in a row
ALTER TABLE game_rooms
ADD COLUMN consecutive_sixes JSONB DEFAULT '{}'::jsonb;

-- Format: { "user_id": count }
COMMENT ON COLUMN game_rooms.consecutive_sixes IS 'Tracks consecutive 6s rolled by each player';
