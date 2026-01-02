import { supabaseAdmin } from '../config/supabase.js';

const isBotId = (id) => id && (id.startsWith('00000000-') || id.startsWith('bot_'));

async function _getUserStats(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('games_won,games_lost,win_streak,tournaments_won')
    .eq('uid', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function _updateUserStats(userId, patch) {
  const { error } = await supabaseAdmin.from('users').update(patch).eq('uid', userId);
  if (error) throw error;
}

export async function recordMatchResult({ winnerUserIds, loserUserIds }) {
  const winners = (winnerUserIds || []).filter((id) => !isBotId(id));
  const losers = (loserUserIds || []).filter((id) => !isBotId(id));

  for (const winnerId of winners) {
    const current = await _getUserStats(winnerId);
    if (!current) continue;

    const gamesWon = Number(current.games_won ?? 0) + 1;
    const winStreak = Number(current.win_streak ?? 0) + 1;

    await _updateUserStats(winnerId, {
      games_won: gamesWon,
      win_streak: winStreak,
    });
  }

  for (const loserId of losers) {
    const current = await _getUserStats(loserId);
    if (!current) continue;

    const gamesLost = Number(current.games_lost ?? 0) + 1;

    await _updateUserStats(loserId, {
      games_lost: gamesLost,
      win_streak: 0,
    });
  }
}

export async function recordTournamentWon({ winnerUserIds }) {
  const winners = (winnerUserIds || []).filter((id) => !isBotId(id));

  for (const winnerId of winners) {
    const current = await _getUserStats(winnerId);
    if (!current) continue;

    const tournamentsWon = Number(current.tournaments_won ?? 0) + 1;

    await _updateUserStats(winnerId, {
      tournaments_won: tournamentsWon,
    });
  }
}
