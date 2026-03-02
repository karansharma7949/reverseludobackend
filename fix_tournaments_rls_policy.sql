-- Fix RLS policy for tournaments table to allow inserts from admin panel
-- Run this in Supabase SQL Editor

-- Option 1: Allow anyone to insert tournaments (for admin panel without auth)
CREATE POLICY "Allow insert tournaments" ON tournaments
    FOR INSERT WITH CHECK (true);

-- Option 2: Allow anyone to update tournaments
CREATE POLICY "Allow update tournaments" ON tournaments
    FOR UPDATE USING (true);

-- Option 3: Allow anyone to delete tournaments  
CREATE POLICY "Allow delete tournaments" ON tournaments
    FOR DELETE USING (true);

-- If the above policies already exist and you're still getting errors,
-- you may need to drop and recreate them:

-- DROP POLICY IF EXISTS "Allow insert tournaments" ON tournaments;
-- DROP POLICY IF EXISTS "Allow update tournaments" ON tournaments;
-- DROP POLICY IF EXISTS "Allow delete tournaments" ON tournaments;

-- Then run the CREATE POLICY statements above again.

-- Alternative: Disable RLS entirely for tournaments table (not recommended for production)
-- ALTER TABLE tournaments DISABLE ROW LEVEL SECURITY;
