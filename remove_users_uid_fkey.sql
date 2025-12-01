-- Remove foreign key constraint from users table to allow bot entries
-- This allows bots (with generated UUIDs) to exist in users table without being in auth.users

-- Drop the foreign key constraint on users.uid
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_uid_fkey;

-- Also need to drop foreign key on game_rooms.turn to allow bot turns
ALTER TABLE game_rooms
DROP CONSTRAINT IF EXISTS game_rooms_turn_fkey;

-- And drop foreign key on game_rooms.host_id (but we'll keep this one for real users)
-- Actually, keep host_id constraint since host must be a real user

-- Verify constraints are removed
SELECT 
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid IN ('users'::regclass, 'game_rooms'::regclass)
AND contype = 'f'  -- foreign key constraints only
ORDER BY table_name, constraint_name;
