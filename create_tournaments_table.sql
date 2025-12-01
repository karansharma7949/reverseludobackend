-- Create tournaments table for bracket-style tournaments
-- Structure: 4 semi-final rooms (2v2 each) -> 4 winners -> 1 final room -> 1 winner

CREATE TABLE IF NOT EXISTS tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id TEXT UNIQUE NOT NULL,
    tournament_name TEXT NOT NULL,
    tournament_icon TEXT, -- URL to tournament icon image
    
    -- Reward configuration
    reward_type TEXT NOT NULL CHECK (reward_type IN ('coins', 'diamonds', 'external_gift')),
    reward_amount INTEGER NOT NULL DEFAULT 0,
    reward_description TEXT, -- For external_gift type, describe the prize
    
    -- Tournament timing
    tournament_starting_time TIMESTAMPTZ NOT NULL,
    tournament_end_date TIMESTAMPTZ,
    entry_fee INTEGER NOT NULL DEFAULT 0,
    
    -- Tournament state - JSONB for flexible room tracking
    -- Structure:
    -- {
    --   "room1": { "state": "waiting|started|finished", "roomId": "uuid", "players": ["uid1", "uid2"], "winner": "uid" },
    --   "room2": { "state": "waiting|started|finished", "roomId": "uuid", "players": ["uid1", "uid2"], "winner": "uid" },
    --   "room3": { "state": "waiting|started|finished", "roomId": "uuid", "players": ["uid1", "uid2"], "winner": "uid" },
    --   "room4": { "state": "waiting|started|finished", "roomId": "uuid", "players": ["uid1", "uid2"], "winner": "uid" },
    --   "semifinalWinners": { "room1": "uid", "room2": "uid", "room3": "uid", "room4": "uid" },
    --   "finalRoom": { "state": "waiting|started|finished", "roomId": "uuid", "players": ["uid1", "uid2", "uid3", "uid4"] },
    --   "finalWinner": "uid"
    -- }
    tournament_state JSONB NOT NULL DEFAULT '{
        "room1": { "state": "waiting", "roomId": null, "players": [], "winner": null },
        "room2": { "state": "waiting", "roomId": null, "players": [], "winner": null },
        "room3": { "state": "waiting", "roomId": null, "players": [], "winner": null },
        "room4": { "state": "waiting", "roomId": null, "players": [], "winner": null },
        "semifinalWinners": { "room1": null, "room2": null, "room3": null, "room4": null },
        "finalRoom": { "state": "waiting", "roomId": null, "players": [] },
        "finalWinner": null
    }'::jsonb,
    
    -- Overall tournament status
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'registration', 'in_progress', 'finals', 'completed', 'cancelled')),
    
    -- Participants tracking
    registered_players JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of user IDs who registered
    max_players INTEGER NOT NULL DEFAULT 8, -- 8 players for 4 semi-final rooms (2 each)
    current_players INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_starting_time ON tournaments(tournament_starting_time);
CREATE INDEX IF NOT EXISTS idx_tournaments_tournament_id ON tournaments(tournament_id);

-- Enable Row Level Security
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read tournaments
CREATE POLICY "Anyone can view tournaments" ON tournaments
    FOR SELECT USING (true);

-- Policy: Only authenticated users can join (handled by backend)
-- The backend will handle registration logic

-- Enable realtime for tournaments table
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tournaments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS tournaments_updated_at_trigger ON tournaments;
CREATE TRIGGER tournaments_updated_at_trigger
    BEFORE UPDATE ON tournaments
    FOR EACH ROW
    EXECUTE FUNCTION update_tournaments_updated_at();

-- Example: Insert a sample tournament
-- INSERT INTO tournaments (
--     tournament_id,
--     tournament_name,
--     tournament_icon,
--     reward_type,
--     reward_amount,
--     tournament_starting_time,
--     entry_fee,
--     status
-- ) VALUES (
--     'TOURNEY_001',
--     'Weekend Championship',
--     'https://example.com/trophy.png',
--     'coins',
--     10000,
--     NOW() + INTERVAL '1 day',
--     500,
--     'registration'
-- );

COMMENT ON TABLE tournaments IS 'Bracket-style tournaments with 4 semi-final rooms and 1 final room';
COMMENT ON COLUMN tournaments.tournament_state IS 'JSONB tracking state of all rooms: room1-4 (semifinals) and finalRoom';
COMMENT ON COLUMN tournaments.reward_type IS 'Type of reward: coins, diamonds, or external_gift';
COMMENT ON COLUMN tournaments.status IS 'Overall tournament status: upcoming, registration, in_progress, finals, completed, cancelled';


-- ============================================
-- Tournament Registrations Table (Optional - for detailed tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS tournament_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, -- References users.uid
    
    -- Registration details
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entry_fee_paid INTEGER NOT NULL DEFAULT 0,
    
    -- Assignment to semi-final room (1-4)
    assigned_room INTEGER CHECK (assigned_room >= 1 AND assigned_room <= 4),
    
    -- Player's tournament progress
    status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'playing_semifinal', 'eliminated_semifinal', 'waiting_final', 'playing_final', 'eliminated_final', 'winner')),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure unique registration per tournament
    UNIQUE(tournament_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_tournament ON tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_user ON tournament_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_status ON tournament_registrations(status);

-- Enable RLS
ALTER TABLE tournament_registrations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own registrations
CREATE POLICY "Users can view own registrations" ON tournament_registrations
    FOR SELECT USING (auth.uid()::text = user_id);

-- Policy: Anyone can see registrations (for leaderboard/bracket display)
CREATE POLICY "Anyone can view all registrations" ON tournament_registrations
    FOR SELECT USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_registrations;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_tournament_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournament_registrations_updated_at_trigger ON tournament_registrations;
CREATE TRIGGER tournament_registrations_updated_at_trigger
    BEFORE UPDATE ON tournament_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_tournament_registrations_updated_at();

COMMENT ON TABLE tournament_registrations IS 'Tracks user registrations and progress in tournaments';


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
