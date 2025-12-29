import { supabaseAdmin } from '../config/supabase.js';

const ACTIVE_MISSIONS_CACHE_TTL_MS = 30_000;

/**
 * Cache: taskType -> { expiresAt: number, missions: Array<{id: string}> }
 */
const _activeMissionCache = new Map();

function _isBotId(id) {
  return id && (id.startsWith('00000000-') || id.startsWith('bot_'));
}

async function _getActiveEventIds() {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('is_active', true)
    .lte('start_at', nowIso)
    .gte('end_at', nowIso);

  if (error) throw error;
  return (data || []).map((row) => row.id);
}

async function _getActiveMissionsForTask(taskType) {
  const now = Date.now();
  const cached = _activeMissionCache.get(taskType);
  if (cached && cached.expiresAt > now) return cached.missions;

  const activeEventIds = await _getActiveEventIds();
  if (!activeEventIds.length) {
    const empty = { expiresAt: now + ACTIVE_MISSIONS_CACHE_TTL_MS, missions: [] };
    _activeMissionCache.set(taskType, empty);
    return empty.missions;
  }

  const { data, error } = await supabaseAdmin
    .from('event_missions')
    .select('id')
    .eq('task_type', taskType)
    .in('event_id', activeEventIds);

  if (error) throw error;

  const missions = (data || []).map((row) => ({ id: row.id }));
  _activeMissionCache.set(taskType, { expiresAt: now + ACTIVE_MISSIONS_CACHE_TTL_MS, missions });
  return missions;
}

async function _incrementMissionsForUser(userId, taskType, delta) {
  if (!userId || _isBotId(userId)) return;
  if (!delta || delta <= 0) return;

  const missions = await _getActiveMissionsForTask(taskType);
  if (!missions.length) return;

  for (const mission of missions) {
    try {
      const { error } = await supabaseAdmin.rpc('increment_event_mission_progress', {
        p_user_id: String(userId),
        p_mission_id: String(mission.id),
        p_delta: Number(delta),
      });
      if (error) throw error;
    } catch (e) {
      console.error('[EventsProgress] Failed to increment mission progress', {
        userId,
        taskType,
        missionId: mission.id,
        delta,
        error: e?.message ?? e,
      });
    }
  }
}

export async function recordKills({ killerUserId, kills }) {
  await _incrementMissionsForUser(killerUserId, 'kills', kills);
}

export async function recordGamePlayed({ userIds, mode }) {
  const taskType =
    mode === 'online'
      ? 'play_online'
      : mode === 'friends'
      ? 'play_with_friends'
      : mode === 'teamup'
      ? 'play_teamup'
      : null;

  if (!taskType) return;

  for (const userId of userIds || []) {
    await _incrementMissionsForUser(userId, taskType, 1);
  }
}

export async function recordGameWon({ winnerUserIds, mode }) {
  const taskType =
    mode === 'online'
      ? 'win_online'
      : mode === 'teamup'
      ? 'win_teamup'
      : null;

  if (!taskType) return;

  for (const userId of winnerUserIds || []) {
    await _incrementMissionsForUser(userId, taskType, 1);
  }
}
