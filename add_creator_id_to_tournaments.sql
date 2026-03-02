-- Add creator_id column to tournaments table
-- This allows players to create their own tournaments

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS creator_id TEXT;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_tournaments_creator_id ON tournaments(creator_id);

-- Comment
COMMENT ON COLUMN tournaments.creator_id IS 'User ID of the tournament creator - entry fees are transferred to this user';
