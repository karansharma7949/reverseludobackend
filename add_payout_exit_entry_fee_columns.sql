ALTER TABLE IF EXISTS public.game_rooms
  ADD COLUMN IF NOT EXISTS entry_fee integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_processed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS exited_players uuid[] DEFAULT '{}'::uuid[];

ALTER TABLE IF EXISTS public.friend_rooms
  ADD COLUMN IF NOT EXISTS entry_fee integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_processed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS exited_players uuid[] DEFAULT '{}'::uuid[];

ALTER TABLE IF EXISTS public.team_up_rooms
  ADD COLUMN IF NOT EXISTS entry_fee integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_processed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS exited_players uuid[] DEFAULT '{}'::uuid[];
