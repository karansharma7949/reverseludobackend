-- Add tournament_participants JSONB column to tournaments table
-- This stores all participant data in one place

-- Structure of tournament_participants:
-- {
--   "user_id_1": {
--     "joined_at": "2024-01-01T00:00:00Z",
--     "entry_fee_paid": 1000,
--     "status": "waiting", -- waiting, semifinal, eliminated, finalist, winner
--     "semifinal_room_id": "uuid",
--     "final_position": 1,
--     "is_bot": false
--   },
--   "user_id_2": { ... }
-- }

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_participants JSONB DEFAULT '{}';

-- Add final_rankings column if not exists
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS final_rankings TEXT[];

-- Example query to get all participants:
-- SELECT tournament_participants FROM tournaments WHERE tournament_id = 'xxx';

-- Example query to add a participant:
-- UPDATE tournaments 
-- SET tournament_participants = tournament_participants || '{"user_id": {"joined_at": "...", "status": "waiting"}}'::jsonb
-- WHERE tournament_id = 'xxx';
