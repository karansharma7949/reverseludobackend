-- Add reward_image column to tournaments table
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS reward_image TEXT;

COMMENT ON COLUMN tournaments.reward_image IS 'URL to the reward image (coins, diamonds, or prize image)';

-- ============================================
-- Storage Bucket Setup for Tournament Assets
-- ============================================
-- Run these commands in Supabase SQL Editor to create the storage bucket:

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('tournament-assets', 'tournament-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to tournament assets
CREATE POLICY "Public Read Access for Tournament Assets" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'tournament-assets');

-- Allow anyone to upload tournament assets (for admin panel)
CREATE POLICY "Allow Upload Tournament Assets" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'tournament-assets');

-- Allow anyone to update tournament assets
CREATE POLICY "Allow Update Tournament Assets" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'tournament-assets');

-- Allow anyone to delete tournament assets
CREATE POLICY "Allow Delete Tournament Assets" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'tournament-assets');
