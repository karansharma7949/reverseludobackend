-- Create game_rooms table
CREATE TABLE game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id VARCHAR(20) UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  players JSONB DEFAULT '{}',
  positions JSONB DEFAULT '{
    "red": {"tokenA": 0, "tokenB": 0, "tokenC": 0, "tokenD": 0},
    "blue": {"tokenA": 0, "tokenB": 0, "tokenC": 0, "tokenD": 0},
    "green": {"tokenA": 0, "tokenB": 0, "tokenC": 0, "tokenD": 0},
    "yellow": {"tokenA": 0, "tokenB": 0, "tokenC": 0, "tokenD": 0}
  }',
  no_of_players INTEGER NOT NULL CHECK (no_of_players IN (2, 3, 4, 5, 6)),
  board_theme VARCHAR(50) DEFAULT 'classic',
  dice_state VARCHAR(20) DEFAULT 'waiting' CHECK (dice_state IN ('waiting', 'rolling', 'complete')),
  dice_result INTEGER CHECK (dice_result >= 1 AND dice_result <= 6),
  pending_steps JSONB DEFAULT '{}'::jsonb,
  consecutive_sixes JSONB DEFAULT '{}'::jsonb,
  game_state VARCHAR(20) DEFAULT 'waiting' CHECK (game_state IN ('waiting', 'playing', 'finished')),
  turn UUID REFERENCES auth.users(id),
  winners UUID[] DEFAULT '{}',
  escaped_players UUID[] DEFAULT '{}',
  disconnected_players UUID[] DEFAULT '{}',
  kicked_players UUID[] DEFAULT '{}',
  timeout_misses JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_game_rooms_room_id ON game_rooms(room_id);
CREATE INDEX idx_game_rooms_host_id ON game_rooms(host_id);
CREATE INDEX idx_game_rooms_game_state ON game_rooms(game_state);

-- Enable Row Level Security
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view game rooms"
  ON game_rooms FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create game rooms"
  ON game_rooms FOR INSERT
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host and players can update game room"
  ON game_rooms FOR UPDATE
  USING (
    auth.uid() = host_id OR 
    auth.uid() = ANY(players)
  );

CREATE POLICY "Host can delete game room"
  ON game_rooms FOR DELETE
  USING (auth.uid() = host_id);

-- Enable Realtime for live game updates
ALTER PUBLICATION supabase_realtime ADD TABLE game_rooms;

-- Function to auto-update updated_at
CREATE TRIGGER update_game_rooms_updated_at
  BEFORE UPDATE ON game_rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to generate unique room ID
CREATE OR REPLACE FUNCTION generate_room_id()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE game_rooms IS 'Stores game room information for multiplayer Ludo games';
COMMENT ON COLUMN game_rooms.room_id IS 'Unique 6-character room code for joining';
COMMENT ON COLUMN game_rooms.players IS 'JSON object mapping player UID to assigned color: {"user_uuid": "red", "user2_uuid": "blue"}';
COMMENT ON COLUMN game_rooms.positions IS 'JSON object storing token positions for each color';
COMMENT ON COLUMN game_rooms.dice_state IS 'Current state of dice: waiting, rolling, or complete';
COMMENT ON COLUMN game_rooms.dice_result IS 'Result of dice roll (1-6), null when waiting or rolling';
COMMENT ON COLUMN game_rooms.game_state IS 'Current game state: waiting, playing, or finished';
COMMENT ON COLUMN game_rooms.turn IS 'UID of player whose turn it is';
COMMENT ON COLUMN game_rooms.winners IS 'Array of player UIDs in order of finishing (1st, 2nd, 3rd, 4th)';
