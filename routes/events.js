import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

function _isBotId(id) {
  return id && (id.startsWith('00000000-') || id.startsWith('bot_'));
}

async function _getActiveEvents() {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, title, description, banner_url, start_at, end_at, is_active, display_order')
    .eq('is_active', true)
    .lte('start_at', nowIso)
    .gte('end_at', nowIso)
    .order('display_order', { ascending: true })
    .order('start_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

router.get('/', async (req, res) => {
  try {
    const events = await _getActiveEvents();
    return res.json({ success: true, events });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:eventId', authenticateUser, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user?.id;

    if (!userId || _isBotId(userId)) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const nowIso = new Date().toISOString();

    const { data: event, error: eventErr } = await supabaseAdmin
      .from('events')
      .select('id, title, description, banner_url, start_at, end_at, is_active, display_order')
      .eq('id', eventId)
      .eq('is_active', true)
      .lte('start_at', nowIso)
      .gte('end_at', nowIso)
      .maybeSingle();

    if (eventErr) throw eventErr;
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { data: missions, error: missionsErr } = await supabaseAdmin
      .from('event_missions')
      .select('id, task_type, target, reward_type, reward_amount, reward_item_id, reward_duration_days')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (missionsErr) throw missionsErr;

    const missionIds = (missions || []).map((m) => m.id);

    let progressRows = [];
    let claimRows = [];

    if (missionIds.length) {
      const { data: progress, error: progErr } = await supabaseAdmin
        .from('user_event_mission_progress')
        .select('mission_id, progress, completed_at')
        .eq('user_id', userId)
        .in('mission_id', missionIds);

      if (progErr) throw progErr;
      progressRows = progress || [];

      const { data: claims, error: claimsErr } = await supabaseAdmin
        .from('user_event_mission_claims')
        .select('mission_id, claimed_at, reward_granted, granted_at')
        .eq('user_id', userId)
        .in('mission_id', missionIds);

      if (claimsErr) throw claimsErr;
      claimRows = claims || [];
    }

    const progressByMission = new Map(progressRows.map((r) => [r.mission_id, r]));
    const claimByMission = new Map(claimRows.map((r) => [r.mission_id, r]));

    const enrichedMissions = (missions || []).map((m) => {
      const prog = progressByMission.get(m.id);
      const claim = claimByMission.get(m.id);
      const progress = Number(prog?.progress ?? 0);
      const target = Number(m.target ?? 0);
      const completed = progress >= target;
      const claimed = Boolean(claim?.reward_granted);

      return {
        ...m,
        progress,
        completed,
        claimed,
        completed_at: prog?.completed_at ?? null,
        claimed_at: claim?.claimed_at ?? null,
        granted_at: claim?.granted_at ?? null,
      };
    });

    return res.json({ success: true, event, missions: enrichedMissions });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/missions/:missionId/claim', authenticateUser, async (req, res) => {
  try {
    const { missionId } = req.params;
    const userId = req.user?.id;

    if (!userId || _isBotId(userId)) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const nowIso = new Date().toISOString();

    // Mission + event validity
    const { data: mission, error: missionErr } = await supabaseAdmin
      .from('event_missions')
      .select('id, event_id, task_type, target, reward_type, reward_amount, reward_item_id, reward_duration_days')
      .eq('id', missionId)
      .maybeSingle();

    if (missionErr) throw missionErr;
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const { data: event, error: eventErr } = await supabaseAdmin
      .from('events')
      .select('id, is_active, start_at, end_at')
      .eq('id', mission.event_id)
      .maybeSingle();

    if (eventErr) throw eventErr;
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (!event.is_active || event.start_at > nowIso || event.end_at < nowIso) {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Must be completed
    const { data: progressRow, error: progressErr } = await supabaseAdmin
      .from('user_event_mission_progress')
      .select('progress, completed_at')
      .eq('user_id', userId)
      .eq('mission_id', missionId)
      .maybeSingle();

    if (progressErr) throw progressErr;

    const progress = Number(progressRow?.progress ?? 0);
    const target = Number(mission.target ?? 0);

    if (progress < target) {
      return res.status(400).json({ error: 'Mission not completed yet', progress, target });
    }

    // Insert claim row (idempotent)
    let claimRow;
    const { data: insertedClaim, error: insertErr } = await supabaseAdmin
      .from('user_event_mission_claims')
      .insert({ user_id: userId, mission_id: missionId })
      .select('*')
      .maybeSingle();

    if (insertErr) {
      // Unique violation => already exists
      const { data: existing, error: fetchClaimErr } = await supabaseAdmin
        .from('user_event_mission_claims')
        .select('*')
        .eq('user_id', userId)
        .eq('mission_id', missionId)
        .maybeSingle();

      if (fetchClaimErr) throw fetchClaimErr;
      claimRow = existing;
    } else {
      claimRow = insertedClaim;
    }

    if (!claimRow) {
      return res.status(500).json({ error: 'Failed to create or load claim record' });
    }

    if (claimRow.reward_granted === true) {
      return res.json({ success: true, claimed: true, alreadyClaimed: true });
    }

    // Try to acquire processing lock
    const { data: lockRow, error: lockErr } = await supabaseAdmin
      .from('user_event_mission_claims')
      .update({ processing: true, processing_started_at: nowIso, error_text: null })
      .eq('user_id', userId)
      .eq('mission_id', missionId)
      .eq('reward_granted', false)
      .eq('processing', false)
      .select('*')
      .maybeSingle();

    if (lockErr) throw lockErr;

    if (!lockRow) {
      // Someone else is processing; return current state
      const { data: current, error: currentErr } = await supabaseAdmin
        .from('user_event_mission_claims')
        .select('*')
        .eq('user_id', userId)
        .eq('mission_id', missionId)
        .maybeSingle();

      if (currentErr) throw currentErr;
      const already = Boolean(current?.reward_granted);
      return res.json({ success: true, claimed: already, processing: true });
    }

    // Grant reward
    try {
      if (mission.reward_type === 'coins') {
        const amount = Number(mission.reward_amount ?? 0);
        if (amount > 0) {
          const { error: rpcErr } = await supabaseAdmin.rpc('add_coins', {
            p_user_id: String(userId),
            p_amount: amount,
          });
          if (rpcErr) throw rpcErr;
        }
      } else if (mission.reward_type === 'diamonds') {
        const amount = Number(mission.reward_amount ?? 0);
        if (amount > 0) {
          const { data: userRow, error: userErr } = await supabaseAdmin
            .from('users')
            .select('total_diamonds')
            .eq('uid', userId)
            .single();
          if (userErr) throw userErr;
          const current = Number(userRow?.total_diamonds ?? 0);
          const { error: updErr } = await supabaseAdmin
            .from('users')
            .update({ total_diamonds: current + amount })
            .eq('uid', userId);
          if (updErr) throw updErr;
        }
      } else if (mission.reward_type === 'talk_time') {
        // reward_amount is treated as minutes
        const minutes = Number(mission.reward_amount ?? 0);
        if (minutes > 0) {
          const { data: userRow, error: userErr } = await supabaseAdmin
            .from('users')
            .select('talk_time_end_date')
            .eq('uid', userId)
            .single();
          if (userErr) throw userErr;

          const now = new Date();
          const currentEnd = userRow?.talk_time_end_date ? new Date(userRow.talk_time_end_date) : null;
          const base = currentEnd && currentEnd > now ? currentEnd : now;
          const newEnd = new Date(base.getTime() + minutes * 60_000);

          const { error: updErr } = await supabaseAdmin
            .from('users')
            .update({ talk_time_end_date: newEnd.toISOString() })
            .eq('uid', userId);
          if (updErr) throw updErr;
        }
      } else if (mission.reward_type === 'inventory_item') {
        const itemId = (mission.reward_item_id ?? '').toString();
        if (itemId) {
          const { data: userRow, error: userErr } = await supabaseAdmin
            .from('users')
            .select('owned_items')
            .eq('uid', userId)
            .single();
          if (userErr) throw userErr;

          const owned = Array.isArray(userRow?.owned_items) ? [...userRow.owned_items] : [];
          if (!owned.includes(itemId)) {
            owned.push(itemId);
            const { error: updErr } = await supabaseAdmin
              .from('users')
              .update({ owned_items: owned })
              .eq('uid', userId);
            if (updErr) throw updErr;
          }
        }
      }

      const grantedAt = new Date().toISOString();
      const { error: markErr } = await supabaseAdmin
        .from('user_event_mission_claims')
        .update({
          reward_granted: true,
          granted_at: grantedAt,
          processing: false,
          processing_started_at: null,
          error_text: null,
        })
        .eq('user_id', userId)
        .eq('mission_id', missionId);

      if (markErr) throw markErr;

      return res.json({ success: true, claimed: true, granted_at: grantedAt });
    } catch (e) {
      const errMsg = e?.message ?? String(e);
      await supabaseAdmin
        .from('user_event_mission_claims')
        .update({ processing: false, error_text: errMsg })
        .eq('user_id', userId)
        .eq('mission_id', missionId);

      return res.status(500).json({ error: errMsg });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
