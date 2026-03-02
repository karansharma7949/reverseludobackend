-- Add columns needed for tournament system
-- Run this SQL in Supabase SQL Editor

-- Add tournament_participants JSONB column to tournaments table
-- Structure: { "userId": { joined_at, status, semifinal_room_id, final_position, is_bot, prize_won } }
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_participants JSONB DEFAULT '{}'::jsonb;

-- Add final_rankings TEXT array to tournaments table
-- Stores ordered list of user IDs by final position
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS final_rankings TEXT[];

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tournaments' 
AND column_name IN ('tournament_participants', 'final_rankings');
