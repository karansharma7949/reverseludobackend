-- Fix RLS policies for dares table to allow admin operations
-- Run this in Supabase SQL Editor

-- First, check existing policies
-- SELECT * FROM pg_policies WHERE tablename = 'dares';

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "Allow public read access for active dares" ON dares;
DROP POLICY IF EXISTS "Allow authenticated read all dares" ON dares;
DROP POLICY IF EXISTS "Allow service role full access" ON dares;
DROP POLICY IF EXISTS "Enable read access for all users" ON dares;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON dares;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON dares;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON dares;

-- Create new permissive policies

-- Allow anyone to read active dares (for the game)
CREATE POLICY "Public read active dares" ON dares
  FOR SELECT USING (is_active = true);

-- Allow authenticated users to read all dares (for admin)
CREATE POLICY "Authenticated read all dares" ON dares
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert dares (for admin)
CREATE POLICY "Authenticated insert dares" ON dares
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to update dares (for admin)
CREATE POLICY "Authenticated update dares" ON dares
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to delete dares (for admin)
CREATE POLICY "Authenticated delete dares" ON dares
  FOR DELETE TO authenticated USING (true);

-- Grant necessary permissions
GRANT SELECT ON dares TO anon;
GRANT ALL ON dares TO authenticated;
GRANT ALL ON dares TO service_role;
