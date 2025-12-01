-- Add game statistics columns to users table
-- Run this in Supabase SQL Editor

ALTER TABLE users
ADD COLUMN IF NOT EXISTS games_won INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS games_lost INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS win_streak INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tournaments_won INTEGER DEFAULT 0;

-- Create index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_users_games_won ON users(games_won DESC);
CREATE INDEX IF NOT EXISTS idx_users_win_streak ON users(win_streak DESC);
CREATE INDEX IF NOT EXISTS idx_users_tournaments_won ON users(tournaments_won DESC);

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('games_won', 'games_lost', 'win_streak', 'tournaments_won');
