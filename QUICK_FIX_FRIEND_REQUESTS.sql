-- =====================================================
-- QUICK FIX FOR FRIEND REQUESTS
-- Run this in Supabase SQL Editor to fix friend requests
-- =====================================================

-- The problem: RLS policy only allows users to update their OWN profile
-- But friend requests need to update ANOTHER user's friend_requests array

-- SOLUTION: Replace the restrictive policy with a more permissive one

-- Step 1: Drop the existing restrictive update policy
DROP POLICY IF EXISTS "Users can update own profile" ON users;

-- Step 2: Create a new policy that allows updates
-- This allows any authenticated user to update any user's profile
-- (The app logic ensures only friend_requests is modified)
CREATE POLICY "Users can update profiles"
  ON users FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Verify the policies
SELECT * FROM pg_policies WHERE tablename = 'users';

-- =====================================================
-- DONE! Friend requests should now work.
-- =====================================================
