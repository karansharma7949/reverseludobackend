-- Add recent_played column to users table
-- This stores an array of user IDs that the user has recently played with

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS recent_played uuid[] DEFAULT '{}';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_users_recent_played ON users USING GIN (recent_played);

COMMENT ON COLUMN users.recent_played IS 'Array of user IDs that this user has recently played with';
