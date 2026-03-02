-- Fix RLS policies for tournament_rooms table
-- Run this in Supabase SQL Editor

-- Add INSERT policy for authenticated users
CREATE POLICY "Authenticated users can create tournament rooms" ON tournament_rooms
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Add DELETE policy for authenticated users (optional, for cleanup)
CREATE POLICY "Authenticated users can delete tournament rooms" ON tournament_rooms
    FOR DELETE USING (auth.role() = 'authenticated');

-- Alternative: If you want to allow all operations without restrictions
-- DROP POLICY IF EXISTS "Anyone can view tournament rooms" ON tournament_rooms;
-- DROP POLICY IF EXISTS "Authenticated users can update tournament rooms" ON tournament_rooms;
-- DROP POLICY IF EXISTS "Authenticated users can create tournament rooms" ON tournament_rooms;
-- DROP POLICY IF EXISTS "Authenticated users can delete tournament rooms" ON tournament_rooms;
-- CREATE POLICY "Allow all operations on tournament rooms" ON tournament_rooms FOR ALL USING (true) WITH CHECK (true);
