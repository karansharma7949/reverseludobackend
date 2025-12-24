/**
 * Team Up Bot Routes
 * 
 * API endpoints for managing bots in Team Up mode
 */

import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import {
  isBot,
  FIXED_BOT_IDS,
  handleBotTurn,
  startBotService,
  stopBotService,
  botRollDice,
  botCompleteDice,
  botMoveToken,
} from '../services/botService.js';

const router = express.Router();

// ============================================
// START BOT SERVICE FOR A ROOM
// ============================================

/**
 * POST /teamup-bots/:roomId/start
 * Start the bot service for a room (called when game starts)
 */
router.post('/:roomId/start', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    console.log(`🚀 [TEAMUP BOTS] Starting bot service for room ${roomId}`);
    
    // Verify room exists
    const { data: room, error } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (error || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Start bot service
    await startBotService(roomId);
    
    res.json({ 
      success: true, 
      message: 'Bot service started',
      roomId,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error starting bot service:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STOP BOT SERVICE FOR A ROOM
// ============================================

/**
 * POST /teamup-bots/:roomId/stop
 * Stop the bot service for a room (called when game ends)
 */
router.post('/:roomId/stop', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    console.log(`🛑 [TEAMUP BOTS] Stopping bot service for room ${roomId}`);
    
    await stopBotService(roomId);
    
    res.json({ 
      success: true, 
      message: 'Bot service stopped',
      roomId,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error stopping bot service:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRIGGER BOT TURN (MANUAL)
// ============================================

/**
 * POST /teamup-bots/:roomId/trigger
 * Manually trigger a bot turn (fallback if realtime fails)
 */
router.post('/:roomId/trigger', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    console.log(`🎮 [TEAMUP BOTS] Triggering bot turn for room ${roomId}`);
    
    // Get current room state
    const { data: room, error } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (error || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if it's a bot's turn
    const currentTurn = room.turn;
    if (!isBot(currentTurn)) {
      return res.status(400).json({ error: 'Not a bot turn' });
    }
    
    // Handle bot turn
    await handleBotTurn(room);
    
    res.json({ 
      success: true, 
      message: 'Bot turn triggered',
      botId: currentTurn,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error triggering bot turn:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BOT ROLL DICE
// ============================================

/**
 * POST /teamup-bots/:roomId/roll-dice
 * Bot rolls dice
 */
router.post('/:roomId/roll-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;
    
    console.log(`🎲 [TEAMUP BOTS] Bot ${botUserId} rolling dice in room ${roomId}`);
    
    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }
    
    // Verify it's a valid bot
    if (!isBot(botUserId)) {
      return res.status(400).json({ error: 'Invalid bot ID' });
    }
    
    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Verify it's the bot's turn
    if (room.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }
    
    // Roll dice
    const diceResult = await botRollDice(roomId, botUserId);
    
    res.json({ 
      success: true, 
      diceResult,
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error rolling dice:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BOT COMPLETE DICE
// ============================================

/**
 * POST /teamup-bots/:roomId/complete-dice
 * Bot completes dice (after animation)
 */
router.post('/:roomId/complete-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;
    
    console.log(`🎲 [TEAMUP BOTS] Bot ${botUserId} completing dice in room ${roomId}`);
    
    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }
    
    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Complete dice
    await botCompleteDice(roomId, botUserId, room);
    
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error completing dice:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BOT MOVE TOKEN
// ============================================

/**
 * POST /teamup-bots/:roomId/move-token
 * Bot moves a token
 */
router.post('/:roomId/move-token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;
    
    console.log(`🎯 [TEAMUP BOTS] Bot ${botUserId} moving token in room ${roomId}`);
    
    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }
    
    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Move token
    await botMoveToken(roomId, botUserId, room);
    
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error moving token:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CHECK IF BOT SHOULD PLAY
// ============================================

/**
 * GET /teamup-bots/:roomId/should-play/:userId
 * Check if a bot should play for a user (disconnected player)
 */
router.get('/:roomId/should-play/:userId', async (req, res) => {
  try {
    const { roomId, userId } = req.params;
    
    // Get room
    const { data: room, error } = await supabaseAdmin
      .from('team_up_rooms')
      .select('disconnected_players')
      .eq('room_id', roomId)
      .single();
    
    if (error || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const disconnectedPlayers = room.disconnected_players || [];
    const shouldBotPlay = isBot(userId) || disconnectedPlayers.includes(userId);
    
    res.json({ 
      shouldBotPlay,
      isBot: isBot(userId),
      isDisconnected: disconnectedPlayers.includes(userId),
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error checking bot status:`, error);
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
    // Get bot profiles from database
    const { data: bots, error } = await supabaseAdmin
      .from('users')
      .select('uid, username, profile_photo')
      .in('uid', FIXED_BOT_IDS);
    
    if (error) throw error;
    
    res.json({
      botIds: FIXED_BOT_IDS,
      bots: bots || [],
    });
  } catch (error) {
    console.error(`❌ [TEAMUP BOTS] Error getting bot info:`, error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
