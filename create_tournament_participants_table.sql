-- Tournament Participants Table
-- Tracks players who have joined tournaments

CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TIMESTAMP DEFAULT NOW(),
  entry_fee_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'waiting', -- 'waiting', 'semifinal', 'eliminated', 'finalist', 'winner'
  semifinal_room_id UUID,
  semifinal_position INTEGER, -- 1st, 2nd, 3rd, 4th in semifinal
  final_position INTEGER, -- 1st, 2nd, 3rd, 4th in final
  is_bot BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create unique constraint to prevent duplicate joins
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_participant_unique 
ON tournament_participants(tournament_id, user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament 
ON tournament_participants(tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_user 
ON tournament_participants(user_id);

-- Tournament Rooms Table
-- Tracks semifinal and final game rooms

CREATE TABLE IF NOT EXISTS tournament_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL,
  room_type TEXT NOT NULL, -- 'semifinal' or 'final'
  room_number INTEGER, -- 1, 2, 3, 4 for semifinals
  game_room_id TEXT, -- Reference to actual game_rooms table
  status TEXT DEFAULT 'waiting', -- 'waiting', 'in_progress', 'completed'
  winner_user_id TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tournament_rooms_tournament 
ON tournament_rooms(tournament_id);

-- Function to add coins to a user
CREATE OR REPLACE FUNCTION add_coins(p_user_id TEXT, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE users 
  SET total_coins = total_coins + p_amount 
  WHERE uid = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement tournament player count
CREATE OR REPLACE FUNCTION decrement_tournament_players(p_tournament_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tournaments 
  SET current_players = GREATEST(0, current_players - 1)
  WHERE id = p_tournament_id;
END;
$$ LANGUAGE plpgsql;

-- Enable realtime for tournament_participants
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_participants;
