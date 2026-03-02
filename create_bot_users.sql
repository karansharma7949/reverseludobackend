-- ============================================
-- CREATE BOT USERS IN DATABASE
-- ============================================
-- Run this in Supabase Dashboard → SQL Editor

-- First, ensure is_bot column exists
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- Create 10 bot users with unique IDs
INSERT INTO users (uid, username, is_bot, total_coins, total_diamonds, profile_image_url)
VALUES 
  (gen_random_uuid(), 'Bot_Alpha', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Beta', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Gamma', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Delta', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Epsilon', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Zeta', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Eta', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Theta', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Iota', true, 0, 0, null),
  (gen_random_uuid(), 'Bot_Kappa', true, 0, 0, null)
ON CONFLICT (username) DO NOTHING;

-- Verify bots were created
SELECT uid, username, is_bot 
FROM users 
WHERE is_bot = true
ORDER BY username;
