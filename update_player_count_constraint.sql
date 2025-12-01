-- Update game_rooms table to support 2-6 players
-- This removes the old constraint and adds a new one

-- Drop the old constraint
ALTER TABLE game_rooms 
DROP CONSTRAINT IF EXISTS game_rooms_no_of_players_check;

-- Add new constraint supporting 2, 3, 4, 5, and 6 players
ALTER TABLE game_rooms 
ADD CONSTRAINT game_rooms_no_of_players_check 
CHECK (no_of_players IN (2, 3, 4, 5, 6));

-- Verify the constraint
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'game_rooms'::regclass 
AND conname = 'game_rooms_no_of_players_check';
