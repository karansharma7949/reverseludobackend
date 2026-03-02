-- Create friend_rooms table for private games with friends
-- Structure is IDENTICAL to game_rooms table (just a separate table for friend mode)
CREATE TABLE IF NOT EXISTS friend_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id VARCHAR(20) UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  players JSONB DEFAULT '{}',
  positions JSONB,
  no_of_players INTEGER NOT NULL CHECK (no_of_players IN (4, 5, 6)),
  board_theme VARCHAR(50) DEFAULT 'classic',
  dice_state VARCHAR(20) DEFAULT 'waiting' CHECK (dice_state IN ('waiting', 'rolling', 'complete')),
  dice_result INTEGER CHECK (dice_result >= 1 AND dice_result <= 6),
  pending_steps JSONB DEFAULT '{}',
  game_state VARCHAR(20) DEFAULT 'waiting' CHECK (game_state IN ('waiting', 'playing', 'finished')),
  turn UUID REFERENCES auth.users(id),
  winners UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_friend_rooms_room_id ON friend_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_friend_rooms_host_id ON friend_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_friend_rooms_game_state ON friend_rooms(game_state);

-- Enable Row Level Security
ALTER TABLE friend_rooms ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view friend rooms" ON friend_rooms;
DROP POLICY IF EXISTS "Authenticated users can create friend rooms" ON friend_rooms;
DROP POLICY IF EXISTS "Host and players can update friend room" ON friend_rooms;
DROP POLICY IF EXISTS "Host can delete friend room" ON friend_rooms;

-- RLS Policies (same as game_rooms)
CREATE POLICY "Anyone can view friend rooms"
  ON friend_rooms FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create friend rooms"
  ON friend_rooms FOR INSERT
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host and players can update friend room"
  ON friend_rooms FOR UPDATE
  USING (
    auth.uid() = host_id OR 
    (players ? auth.uid()::text)
  );

CREATE POLICY "Host can delete friend room"
  ON friend_rooms FOR DELETE
  USING (auth.uid() = host_id);

-- Enable Realtime for live game updates
ALTER PUBLICATION supabase_realtime ADD TABLE friend_rooms;

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_friend_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS update_friend_rooms_updated_at ON friend_rooms;

CREATE TRIGGER update_friend_rooms_updated_at
  BEFORE UPDATE ON friend_rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_friend_rooms_updated_at();

-- Add comments for documentation
COMMENT ON TABLE friend_rooms IS 'Stores private game room information for playing with friends (same structure as game_rooms)';
COMMENT ON COLUMN friend_rooms.room_id IS 'Unique 6-character room code that players share with friends';
COMMENT ON COLUMN friend_rooms.players IS 'JSON object mapping player UID to assigned color: {"user_uuid": "red", "user2_uuid": "blue"}';
COMMENT ON COLUMN friend_rooms.positions IS 'JSON object storing token positions for active player colors only (set dynamically based on players)';
COMMENT ON COLUMN friend_rooms.no_of_players IS 'Number of players (4, 5, or 6) - chosen by host when creating room';
COMMENT ON COLUMN friend_rooms.dice_state IS 'Current state of dice: waiting, rolling, or complete';
COMMENT ON COLUMN friend_rooms.dice_result IS 'Result of dice roll (1-6), null when waiting or rolling';
COMMENT ON COLUMN friend_rooms.pending_steps IS 'JSON object storing remaining steps for each player after dice roll';
COMMENT ON COLUMN friend_rooms.game_state IS 'Current game state: waiting (in lobby), playing (game started), or finished';
COMMENT ON COLUMN friend_rooms.turn IS 'UID of player whose turn it is';
COMMENT ON COLUMN friend_rooms.winners IS 'Array of player UIDs in order of finishing (1st, 2nd, 3rd, etc.)';
