-- Add missing escape/kick/timeout/disconnect columns for existing tables

ALTER TABLE IF EXISTS public.friend_rooms
  ADD COLUMN IF NOT EXISTS escaped_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS disconnected_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS kicked_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS timeout_misses jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.team_up_rooms
  ADD COLUMN IF NOT EXISTS kicked_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS timeout_misses jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.game_rooms
  ADD COLUMN IF NOT EXISTS escaped_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS disconnected_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS kicked_players uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS timeout_misses jsonb DEFAULT '{}'::jsonb;

ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_up_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
