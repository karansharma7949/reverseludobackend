-- ============================================
-- Tournament Rooms Table (Same as game_rooms + room_level)
-- ============================================

CREATE TABLE IF NOT EXISTS tournament_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id VARCHAR NOT NULL UNIQUE,
    host_id UUID NOT NULL,
    positions JSONB,
    no_of_players INT4 NOT NULL,
    board_theme VARCHAR,
    dice_state VARCHAR,
    dice_result INT4,
    game_state VARCHAR,
    turn UUID,
    winners _UUID, -- Array of UUIDs
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    players JSONB,
    pending_steps JSONB,
    consecutive_sixes JSONB,
    
    -- Extra column for tournament rooms
    room_level VARCHAR NOT NULL CHECK (room_level IN ('semifinal', 'final')),
    
    -- Reference to the tournament this room belongs to
    tournament_id TEXT REFERENCES tournaments(tournament_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tournament_rooms_room_id ON tournament_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_tournament_rooms_tournament_id ON tournament_rooms(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_rooms_room_level ON tournament_rooms(room_level);
CREATE INDEX IF NOT EXISTS idx_tournament_rooms_game_state ON tournament_rooms(game_state);

-- Enable RLS
ALTER TABLE tournament_rooms ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view tournament rooms
CREATE POLICY "Anyone can view tournament rooms" ON tournament_rooms
    FOR SELECT USING (true);

-- Policy: Authenticated users can update (for game moves)
CREATE POLICY "Authenticated users can update tournament rooms" ON tournament_rooms
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Enable realtime for tournament_rooms
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_rooms;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_tournament_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournament_rooms_updated_at_trigger ON tournament_rooms;
CREATE TRIGGER tournament_rooms_updated_at_trigger
    BEFORE UPDATE ON tournament_rooms
    FOR EACH ROW
    EXECUTE FUNCTION update_tournament_rooms_updated_at();

COMMENT ON TABLE tournament_rooms IS 'Game rooms specifically for tournament matches';
COMMENT ON COLUMN tournament_rooms.room_level IS 'Level of the tournament match: semifinal or final';
COMMENT ON COLUMN tournament_rooms.tournament_id IS 'Reference to the parent tournament';
