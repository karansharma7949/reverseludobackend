-- ============================================
-- DARES SYSTEM SETUP
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- 1. Add 'dare' column to friend_rooms table
ALTER TABLE friend_rooms 
ADD COLUMN IF NOT EXISTS dare TEXT DEFAULT NULL;

-- 2. Create dares table to store all available dares
CREATE TABLE IF NOT EXISTS dares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dare_text TEXT NOT NULL,
    category TEXT DEFAULT 'general', -- e.g., 'funny', 'physical', 'social', 'creative', 'general'
    difficulty TEXT DEFAULT 'easy', -- 'easy', 'medium', 'hard'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_dares_category ON dares(category);
CREATE INDEX IF NOT EXISTS idx_dares_difficulty ON dares(difficulty);
CREATE INDEX IF NOT EXISTS idx_dares_active ON dares(is_active);

-- 4. Enable Row Level Security
ALTER TABLE dares ENABLE ROW LEVEL SECURITY;

-- 5. Create policies for dares table
-- Everyone can read active dares
CREATE POLICY "Anyone can read active dares" ON dares
    FOR SELECT USING (is_active = true);

-- Only authenticated users can insert dares (optional - for user-submitted dares)
CREATE POLICY "Authenticated users can insert dares" ON dares
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 6. Insert sample dares by category (Casual, Funny, Love)
INSERT INTO dares (dare_text, category, difficulty) VALUES
    -- Casual dares
    ('Loser will give a coffee treat', 'casual', 'easy'),
    ('Loser will buy lunch for everyone', 'casual', 'medium'),
    ('Loser will do the dishes for a week', 'casual', 'easy'),
    ('Loser will pay for the next outing', 'casual', 'medium'),
    ('Loser will be the designated driver', 'casual', 'easy'),
    ('Loser will cook dinner for everyone', 'casual', 'medium'),
    ('Loser will clean the room', 'casual', 'easy'),
    ('Loser will give a foot massage', 'casual', 'medium'),
    -- Funny dares
    ('Loser will do 20 push-ups', 'funny', 'easy'),
    ('Loser will sing a song in public', 'funny', 'medium'),
    ('Loser will dance for 1 minute', 'funny', 'easy'),
    ('Loser will speak in an accent for an hour', 'funny', 'medium'),
    ('Loser will post a silly selfie', 'funny', 'easy'),
    ('Loser will do a funny walk everywhere', 'funny', 'medium'),
    ('Loser will tell 5 jokes', 'funny', 'easy'),
    ('Loser will imitate a celebrity', 'funny', 'medium'),
    -- Love dares
    ('Loser will write a love poem', 'love', 'easy'),
    ('Loser will give a romantic compliment', 'love', 'easy'),
    ('Loser will plan a surprise date', 'love', 'medium'),
    ('Loser will give a back massage', 'love', 'easy'),
    ('Loser will make breakfast in bed', 'love', 'medium'),
    ('Loser will write 10 things they love about winner', 'love', 'medium'),
    ('Loser will be the winners servant for a day', 'love', 'hard'),
    ('Loser will serenade the winner', 'love', 'medium')
ON CONFLICT DO NOTHING;

-- 7. Create function to get a random dare
CREATE OR REPLACE FUNCTION get_random_dare(p_category TEXT DEFAULT NULL, p_difficulty TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, dare_text TEXT, category TEXT, difficulty TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.dare_text, d.category, d.difficulty
    FROM dares d
    WHERE d.is_active = true
        AND (p_category IS NULL OR d.category = p_category)
        AND (p_difficulty IS NULL OR d.difficulty = p_difficulty)
    ORDER BY RANDOM()
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 8. Grant execute permission on the function
GRANT EXECUTE ON FUNCTION get_random_dare TO authenticated;
GRANT EXECUTE ON FUNCTION get_random_dare TO anon;

-- 9. Enable realtime for game_rooms dare column (if not already enabled)
-- This ensures clients get updates when dare changes
-- Note: game_rooms should already have realtime enabled

COMMENT ON TABLE dares IS 'Stores all available dares for the Ludo game';
COMMENT ON COLUMN dares.dare_text IS 'The actual dare text to display';
COMMENT ON COLUMN dares.category IS 'Category of dare: casual, funny, love';
COMMENT ON COLUMN dares.difficulty IS 'Difficulty level: easy, medium, hard';
COMMENT ON COLUMN dares.is_active IS 'Whether this dare is currently active/available';
COMMENT ON COLUMN friend_rooms.dare IS 'Current active dare for the friend room';
