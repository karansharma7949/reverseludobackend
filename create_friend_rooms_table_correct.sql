-- Create friend_rooms table for private games with friends
-- This table is used for the waiting room before the game starts
CREATE TABLE IF NOT EXISTS friend_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code VARCHAR(6) UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  players TEXT[] DEFAULT '{}',
  max_players INTEGER NOT NULL CHECK (max_players IN (4, 5, 6)),
  status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'started')),
  game_room_id UUID REFERENCES game_rooms(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_friend_rooms_room_code ON friend_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_friend_rooms_host_id ON friend_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_friend_rooms_status ON friend_rooms(status);

-- Enable Row Level Security
ALTER TABLE friend_rooms ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view friend rooms" ON friend_rooms;
DROP POLICY IF EXISTS "Authenticated users can create friend rooms" ON friend_rooms;
DROP POLICY IF EXISTS "Host and players can update friend room" ON friend_rooms;
DROP POLICY IF EXISTS "Host can delete friend room" ON friend_rooms;

-- RLS Policies
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
    auth.uid()::text = ANY(players)
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
COMMENT ON TABLE friend_rooms IS 'Stores private game room information for playing with friends (waiting room before game starts)';
COMMENT ON COLUMN friend_rooms.room_code IS 'Unique 6-character room code (A-Z, 0-9) that players share with friends';
COMMENT ON COLUMN friend_rooms.host_id IS 'User ID of the player who created the room';
COMMENT ON COLUMN friend_rooms.players IS 'Array of player UIDs who have joined the room';
COMMENT ON COLUMN friend_rooms.max_players IS 'Maximum number of players (4, 5, or 6) - chosen by host when creating room';
COMMENT ON COLUMN friend_rooms.status IS 'Room status: waiting (in lobby) or started (game has begun)';
COMMENT ON COLUMN friend_rooms.game_room_id IS 'Reference to game_rooms table when game starts (NULL while waiting)';
