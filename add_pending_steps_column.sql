-- Add pending_steps column to game_rooms table
-- This stores the remaining steps for each user after rolling the dice
-- Format: { "user_id_1": 6, "user_id_2": 0, ... }

ALTER TABLE game_rooms
ADD COLUMN pending_steps JSONB DEFAULT '{}'::jsonb;

-- Add comment to explain the column
COMMENT ON COLUMN game_rooms.pending_steps IS 'Stores pending dice steps for each user. Key: user_id, Value: remaining steps (0-6)';

-- Example update to initialize pending_steps for existing rooms
-- UPDATE game_rooms 
-- SET pending_steps = '{}'::jsonb 
-- WHERE pending_steps IS NULL;
