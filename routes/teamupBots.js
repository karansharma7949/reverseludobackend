/**
 * Team Up Bot Routes
 * 
 * API endpoints for managing bots in Team Up mode
 * Bots join rooms like real players and play autonomously
 */

import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import {
  FIXED_BOT_IDS,
  BOT_PROFILES,
  isBot,
  getBotProfile,
  addBotToRoom,
  fillRoomWithBots,
  startBotPlayersForRoom,
  stopBotPlayersForRoom,
  getActiveBotCount,
} from '../services/botPlayerService.js';

const router = express.Router();

// ============================================
// ADD SINGLE BOT TO ROOM
// ============================================

/**
 * POST /teamup-bots/:roomId/add-bot
 * Add a single bot to a room (like a player joining)
 */
router.post('/:roomId/add-bot', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botIndex } = req.body;

    console.log(`🤖 [TEAMUP BOTS] Adding bot to room ${roomId}`);

    const result = await addBotToRoom(roomId, botIndex || 0);

    res.json({
      success: true,
      botId: result.botId,
      message: result.alreadyInRoom ? 'Bot already in room' : 'Bot added to room',
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error adding bot:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// FILL ROOM WITH BOTS
// ============================================

/**
 * POST /teamup-bots/:roomId/fill
 * Fill the room with bots to reach 4 players
 */
router.post('/:roomId/fill', async (req, res) => {
  try {
    const { roomId } = req.params;

    console.log(`🤖 [TEAMUP BOTS] Filling room ${roomId} with bots`);

    const addedBots = await fillRoomWithBots(roomId);

    res.json({
      success: true,
      addedBots,
      count: addedBots.length,
      message: `Added ${addedBots.length} bots to room`,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error filling room:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START BOT PLAYERS (AFTER GAME STARTS)
// ============================================

/**
 * POST /teamup-bots/:roomId/start-players
 * Start bot players for a room (they will subscribe and play)
 */
router.post('/:roomId/start-players', async (req, res) => {
  try {
    const { roomId } = req.params;

    console.log(`🚀 [TEAMUP BOTS] Starting bot players for room ${roomId}`);

    const startedBots = await startBotPlayersForRoom(roomId);

    res.json({
      success: true,
      startedBots,
      count: startedBots.length,
      message: `Started ${startedBots.length} bot players`,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error starting bot players:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STOP BOT PLAYERS
// ============================================

/**
 * POST /teamup-bots/:roomId/stop-players
 * Stop all bot players for a room
 */
router.post('/:roomId/stop-players', async (req, res) => {
  try {
    const { roomId } = req.params;

    console.log(`🛑 [TEAMUP BOTS] Stopping bot players for room ${roomId}`);

    await stopBotPlayersForRoom(roomId);

    res.json({
      success: true,
      message: 'Bot players stopped',
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error stopping bot players:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRIGGER BOT (FALLBACK FOR STUCK BOTS)
// ============================================

/**
 * POST /teamup-bots/:roomId/trigger
 * Trigger bot players to check and play their turn (fallback for stuck bots)
 */
router.post('/:roomId/trigger', async (req, res) => {
  try {
    const { roomId } = req.params;

    console.log(`🔄 [TEAMUP BOTS] Triggering bot check for room ${roomId}`);

    // Get current room state
    const { data: room, error } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (error || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if game is playing
    if (room.game_state !== 'playing') {
      return res.json({
        success: true,
        message: 'Game not in playing state',
        triggered: false,
      });
    }

    // Check if current turn is a bot
    const currentTurn = room.turn;
    if (!currentTurn || !isBot(currentTurn)) {
      return res.json({
        success: true,
        message: 'Not a bot turn',
        triggered: false,
      });
    }

    // Start bot players if not already started
    const activeBotCount = getActiveBotCount(roomId);
    if (activeBotCount === 0) {
      console.log(`🚀 [TEAMUP BOTS] No active bots, starting bot players...`);
      await startBotPlayersForRoom(roomId);
    }

    res.json({
      success: true,
      message: 'Bot triggered',
      triggered: true,
      currentTurn,
      activeBotCount: getActiveBotCount(roomId),
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error triggering bot:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET BOT STATUS
// ============================================

/**
 * GET /teamup-bots/:roomId/status
 * Get bot status for a room
 */
router.get('/:roomId/status', async (req, res) => {
  try {
    const { roomId } = req.params;

    const activeBotCount = getActiveBotCount(roomId);

    // Get room to see which bots are in it
    const { data: room, error } = await supabaseAdmin
      .from('team_up_rooms')
      .select('team_a, team_b, players')
      .eq('room_id', roomId)
      .single();

    if (error || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const allPlayers = [...room.team_a, ...room.team_b];
    const botsInRoom = allPlayers.filter(id => isBot(id));

    res.json({
      roomId,
      botsInRoom,
      botCount: botsInRoom.length,
      activeBotPlayers: activeBotCount,
      botProfiles: botsInRoom.map(id => ({
        id,
        ...getBotProfile(id),
        color: room.players[id] || null,
      })),
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error getting status:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET BOT INFO
// ============================================

/**
 * GET /teamup-bots/info
 * Get information about available bots
 */
router.get('/info', async (req, res) => {
  try {
    res.json({
      botIds: FIXED_BOT_IDS,
      botProfiles: BOT_PROFILES,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error getting bot info:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CHECK IF USER IS BOT
// ============================================

/**
 * GET /teamup-bots/is-bot/:userId
 * Check if a user ID is a bot
 */
router.get('/is-bot/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    res.json({
      userId,
      isBot: isBot(userId),
      profile: isBot(userId) ? getBotProfile(userId) : null,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error checking bot:`, error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
