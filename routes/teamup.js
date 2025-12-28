import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import { getBoardPosition } from '../utils/gameHelpers.js';

const router = express.Router();

const DISCONNECT_GRACE_MS = 30_000;
const disconnectRemovalTimers = new Map();

function _clearDisconnectRemovalTimer(roomId, userId) {
  const key = `${roomId}:${userId}`;
  const t = disconnectRemovalTimers.get(key);
  if (t) {
    clearTimeout(t);
    disconnectRemovalTimers.delete(key);
  }
}

function _areAllTokensFinished(room, userId) {
  const color = room?.players?.[userId];
  if (!color) return false;
  const positions = room?.positions?.[color];
  if (!positions) return false;
  return Object.values(positions).every((pos) => pos === 61);
}

function _isPlayerActiveInRoom(room, userId) {
  if (!room?.players?.[userId]) return false;
  const escapedPlayers = room.escaped_players || [];
  const kickedPlayers = room.kicked_players || [];
  const winners = room.winners || [];

  if (escapedPlayers.includes(userId)) return false;
  if (kickedPlayers.includes(userId)) return false;
  if (winners.includes(userId)) return false;
  if (_areAllTokensFinished(room, userId)) return false;
  return true;
}

function _getTeamTurnOrder(room) {
  const teamA = room.team_a || [];
  const teamB = room.team_b || [];
  const order = [teamA[0], teamB[0], teamA[1], teamB[1]].filter(Boolean);

  // Fallback: if teams are not populated for some reason, derive from players map.
  if (order.length === 0) {
    return Object.keys(room.players || {});
  }
  return order;
}

function _getNextActiveTeamPlayer(room, currentUserId) {
  const turnOrder = _getTeamTurnOrder(room);
  if (!turnOrder || turnOrder.length === 0) return currentUserId;

  const startIndex = currentUserId ? turnOrder.indexOf(currentUserId) : -1;
  for (let i = 1; i <= turnOrder.length; i++) {
    const nextIndex = startIndex === -1 ? (i - 1) : (startIndex + i) % turnOrder.length;
    const nextUserId = turnOrder[nextIndex];
    if (nextUserId && _isPlayerActiveInRoom(room, nextUserId)) {
      return nextUserId;
    }
  }

  return currentUserId;
}

async function _finalizeDisconnectRemoval(roomId, userId) {
  _clearDisconnectRemovalTimer(roomId, userId);

  const { data: room, error: fetchError } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (fetchError || !room) return;
  if (room.game_state !== 'playing') return;

  const disconnectedPlayers = room.disconnected_players || [];
  const escapedPlayers = room.escaped_players || [];

  if (!disconnectedPlayers.includes(userId)) return;
  if (escapedPlayers.includes(userId)) return;
  if (!room.players?.[userId]) return;

  const playerColor = room.players[userId];

  let updatedEscaped = [...escapedPlayers];
  if (!updatedEscaped.includes(userId)) updatedEscaped.push(userId);

  let updatedDisconnected = [...disconnectedPlayers].filter((id) => id !== userId);

  let updatedPositions = { ...room.positions };
  if (updatedPositions[playerColor]) {
    updatedPositions[playerColor] = { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 };
  }

  let updatedPendingSteps = { ...(room.pending_steps || {}) };
  delete updatedPendingSteps[userId];

  let nextTurn = room.turn;
  let diceState = room.dice_state;
  let diceResult = room.dice_result;

  const roomForTurn = {
    ...room,
    escaped_players: updatedEscaped,
    positions: updatedPositions,
    pending_steps: updatedPendingSteps,
  };

  if (!nextTurn || !_isPlayerActiveInRoom(roomForTurn, nextTurn)) {
    nextTurn = _getNextActiveTeamPlayer(roomForTurn, nextTurn || userId);
    diceState = 'waiting';
    diceResult = null;
  }

  const teamAActive = (room.team_a || []).filter((id) => !updatedEscaped.includes(id));
  const teamBActive = (room.team_b || []).filter((id) => !updatedEscaped.includes(id));

  let gameState = room.game_state;
  let winners = room.winners || [];

  if (teamAActive.length === 0 && teamBActive.length > 0) {
    gameState = 'finished';
    winners = teamBActive;
  } else if (teamBActive.length === 0 && teamAActive.length > 0) {
    gameState = 'finished';
    winners = teamAActive;
  }

  await supabaseAdmin
    .from('team_up_rooms')
    .update({
      escaped_players: updatedEscaped,
      disconnected_players: updatedDisconnected,
      positions: updatedPositions,
      pending_steps: updatedPendingSteps,
      turn: nextTurn,
      dice_state: diceState,
      dice_result: diceResult,
      game_state: gameState,
      winners: winners,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);
}

// Helper: Get next turn in anticlockwise order (red -> green -> blue -> yellow)
function getNextTeamTurn(players, currentUserId) {
  const turnOrder = ['red', 'green', 'blue', 'yellow'];
  const currentColor = players[currentUserId];
  
  if (!currentColor) return null;
  
  const currentIndex = turnOrder.indexOf(currentColor);
  if (currentIndex === -1) return null;
  
  const nextIndex = (currentIndex + 1) % turnOrder.length;
  const nextColor = turnOrder[nextIndex];
  
  // Find userId with next color
  for (const [userId, color] of Object.entries(players)) {
    if (color === nextColor) return userId;
  }
  
  return null;
}

// Helper: Check if player has valid moves
function hasValidMoves(positions, diceResult) {
  for (const tokenName in positions) {
    const pos = positions[tokenName];
    
    // Token at home (0) - can only move with 6
    if (pos === 0 && diceResult === 6) return true;
    
    // Token on board - can move if not finished
    if (pos > 0 && pos < 61) {
      const newPos = pos + diceResult;
      if (newPos <= 61) return true; // Can move to finish or beyond
    }
  }
  
  return false;
}

// Roll dice for team up mode
router.post('/:roomId/roll-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const { clientDiceResult } = req.body; // CLIENT-FIRST: Accept client dice result

    console.log(`🎲 [TEAM UP BACKEND] Roll dice - Room: ${roomId}, User: ${userId}, ClientDice: ${clientDiceResult}`);

    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      console.log(`❌ [TEAM UP BACKEND] Room not found: ${roomId}`);
      return res.status(404).json({ error: 'Team room not found' });
    }

    // Check if it's player's turn
    if (room.turn !== userId) {
      console.log(`❌ [TEAM UP BACKEND] Not player's turn. Current: ${room.turn}, Requested: ${userId}`);
      return res.status(403).json({ error: 'Not your turn' });
    }

    // Check game state
    if (room.game_state !== 'playing') {
      console.log(`❌ [TEAM UP BACKEND] Game not playing: ${room.game_state}`);
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    // Check if player has pending steps (must move first)
    const pendingSteps = room.pending_steps || {};
    if (pendingSteps[userId] && pendingSteps[userId] > 0) {
      console.log(`❌ [TEAM UP BACKEND] Player has pending steps: ${pendingSteps[userId]}`);
      return res.status(400).json({ error: 'You must move a token first' });
    }

    // CLIENT-FIRST: Use client dice result if provided and valid, otherwise generate server-side
    let diceResult;
    if (clientDiceResult !== undefined && clientDiceResult >= 1 && clientDiceResult <= 6) {
      diceResult = clientDiceResult;
      console.log(`🎲 [TEAM UP BACKEND] Using client-provided dice result: ${diceResult}`);
    } else {
      diceResult = Math.floor(Math.random() * 6) + 1;
      console.log(`🎲 [TEAM UP BACKEND] Generated server dice result: ${diceResult}`);
    }

    // Removed 3 consecutive sixes constraint

    // Update room with dice result (NO pending_steps yet!)
    const { data: updatedRoom, error: updateError} = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) {
      console.log(`❌ [TEAM UP BACKEND] Update error: ${updateError.message}`);
      throw updateError;
    }

    console.log(`✅ [TEAM UP BACKEND] Dice rolled successfully`);
    res.json({ success: true, diceResult, room: updatedRoom });
  } catch (error) {
    console.log(`❌ [TEAM UP BACKEND] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Complete dice (check for valid moves and pass turn if needed)
router.post('/:roomId/complete-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`✅ [TEAM UP BACKEND] Complete dice - Room: ${roomId}, User: ${userId}`);

    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Team room not found' });
    }

    // Already completed or waiting
    if (room.dice_state === 'waiting' || room.dice_state === 'complete') {
      console.log(`✅ [TEAM UP BACKEND] Already completed or waiting`);
      return res.json({ success: true, alreadyCompleted: true, room });
    }

    // Check if it's player's turn - if not, just return success (don't error)
    // This allows the animation to complete without errors when bot is playing
    if (room.turn !== userId) {
      console.log(`ℹ️ [TEAM UP BACKEND] Not user's turn, skipping complete dice`);
      return res.json({ success: true, notYourTurn: true, room });
    }

    const diceResult = room.dice_result || 0;
    const playerColor = room.players[userId];
    const playerPositions = room.positions[playerColor] || {};

    console.log(`🔍 [TEAM UP BACKEND] Checking valid moves for ${playerColor}, dice: ${diceResult}`);

    // Check if player has valid moves
    const validMove = hasValidMoves(playerPositions, diceResult);

    if (!validMove) {
      // No valid moves - pass turn
      const nextTurn = _getNextActiveTeamPlayer(room, userId);
      const consecutiveSixes = room.consecutive_sixes || {};
      if (diceResult !== 6) consecutiveSixes[userId] = 0;

      console.log(`⏭️ [TEAM UP BACKEND] No valid moves, passing turn to: ${nextTurn}`);

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          turn: nextTurn,
          dice_result: null,
          dice_state: 'waiting',
          consecutive_sixes: consecutiveSixes,
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      console.log(`✅ [TEAM UP BACKEND] Turn passed`);
      return res.json({ success: true, noValidMoves: true, room: updatedRoom });
    }

    // Has valid moves - set pending steps and complete state
    const pendingSteps = room.pending_steps || {};
    pendingSteps[userId] = diceResult;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ [TEAM UP BACKEND] Dice completed, player can move`);
    res.json({ success: true, room: updatedRoom });
  } catch (error) {
    console.log(`❌ [TEAM UP BACKEND] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Move token for team up mode
router.post('/:roomId/move-token', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { tokenId, newPosition: clientNewPosition } = req.body;
    const userId = req.user.id;

    console.log(`🚀 [TEAM UP BACKEND] Move token - Room: ${roomId}, User: ${userId}, Token: ${tokenId}`);

    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      console.log(`❌ [TEAM UP BACKEND] Room not found: ${roomId}`);
      return res.status(404).json({ error: 'Team room not found' });
    }

    // Check if it's player's turn
    if (room.turn !== userId) {
      console.log(`❌ [TEAM UP BACKEND] Not player's turn. Current: ${room.turn}, Requested: ${userId}`);
      return res.status(403).json({ error: 'Not your turn' });
    }

    // Check game state
    if (room.game_state !== 'playing') {
      console.log(`❌ [TEAM UP BACKEND] Game not playing: ${room.game_state}`);
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    // Check pending steps (client-first safe: may race with complete-dice)
    const pendingSteps = room.pending_steps || {};
    let stepsToMove = pendingSteps[userId];

    // Parse token (format: "color:tokenName")
    const [color, tokenName] = tokenId.split(':');
    if (!color || !tokenName) {
      return res.status(400).json({ error: 'Invalid token format. Expected color:tokenName' });
    }

    // Check if player owns this color
    const playerColor = room.players[userId];
    if (playerColor !== color) {
      console.log(`❌ [TEAM UP BACKEND] Player ${userId} (${playerColor}) trying to move ${color} token`);
      return res.status(403).json({ error: 'Cannot move opponent\'s token' });
    }

    // Get current position
    const positions = room.positions || {};
    const colorPositions = positions[color] || {};
    const currentPos = colorPositions[tokenName];
    
    if (currentPos === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    // CLIENT-FIRST SUPPORT: if pending_steps not written yet, derive from clientNewPosition or dice_result
    if ((!stepsToMove || stepsToMove <= 0) && typeof clientNewPosition === 'number') {
      if (currentPos === 0 && clientNewPosition === 1) {
        stepsToMove = 6;
      } else {
        stepsToMove = clientNewPosition - currentPos;
      }
    }

    if ((!stepsToMove || stepsToMove <= 0) && (room.dice_result || 0) > 0) {
      stepsToMove = room.dice_result;
    }

    if (!stepsToMove || stepsToMove <= 0) {
      console.log(`❌ [TEAM UP BACKEND] No pending steps for user ${userId}`);
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    // Check if can move from home
    if (currentPos === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }
    
    // Calculate new position
    let newPos = currentPos === 0 ? 1 : currentPos + stepsToMove;

    if (typeof clientNewPosition === 'number') {
      if (clientNewPosition === newPos) {
        newPos = clientNewPosition;
      }
    }
    
    // Check if exceeds home position (61 for 4-player)
    if (newPos > 61) {
      return res.status(400).json({ error: 'Need exact dice count to enter home' });
    }

    console.log(`🚀 [TEAM UP BACKEND] Moving ${color} ${tokenName} from ${currentPos} to ${newPos}`);

    // Update position
    const updatedPositions = { ...positions };
    if (!updatedPositions[color]) updatedPositions[color] = {};
    updatedPositions[color] = { ...updatedPositions[color], [tokenName]: newPos };

    // Check for kills using grid coordinates (opponent team tokens only)
    const killedTokens = [];
    let bonusRoll = false;
    
    const noOfPlayers = 4; // Team up is always 4 players
    
    // Get grid position of moving token
    const movingTokenGridPos = getBoardPosition(color, newPos, noOfPlayers);
    
    // Only check kills if not on safe spot and not in home column
    // CORRECT safe positions for 4-player board (from positions.js)
    const safePositions = [9, 17, 22, 30, 35, 43, 48, 56];
    const isOnSafeSpot = safePositions.includes(newPos);
    
    if (!isOnSafeSpot && newPos > 0 && newPos < 61 && movingTokenGridPos) {
      for (const [otherColor, otherTokens] of Object.entries(updatedPositions)) {
        if (otherColor === color) continue; // Skip same color
        
        // Check if same team (Team A: red+blue, Team B: green+yellow)
        const isTeamA = ['red', 'blue'].includes(color);
        const otherIsTeamA = ['red', 'blue'].includes(otherColor);
        if (isTeamA === otherIsTeamA) continue; // Skip teammate
        
        for (const [otherTokenName, otherPos] of Object.entries(otherTokens)) {
          if (otherPos <= 0 || otherPos >= 61) continue; // Skip home and finish
          
          // Get grid position of opponent token
          const opponentGridPos = getBoardPosition(otherColor, otherPos, noOfPlayers);
          
          // Compare grid coordinates
          if (opponentGridPos && movingTokenGridPos.pos[0] === opponentGridPos.pos[0] && 
              movingTokenGridPos.pos[1] === opponentGridPos.pos[1]) {
            // Kill opponent token
            updatedPositions[otherColor] = { ...updatedPositions[otherColor], [otherTokenName]: 0 };
            killedTokens.push(`${otherColor}:${otherTokenName}`);
            bonusRoll = true;
            console.log(`💀 [TEAM UP BACKEND] ${color} ${tokenName} (grid: [${movingTokenGridPos.pos}]) killed ${otherColor} ${otherTokenName} (grid: [${opponentGridPos.pos}])`);
          }
        }
      }
    }

    // Clear pending steps
    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[userId];

    // Check if token reached finish position (bonus turn)
    const tokenReachedFinish = newPos === 61;
    if (tokenReachedFinish) {
      console.log(`🏠 [TEAM UP] Token reached finish! Player gets bonus turn.`);
    }

    let winners = [...(room.winners || [])];
    const allTokensFinished = Object.values(updatedPositions[color] || {}).every(pos => pos === 61);
    if (allTokensFinished && !winners.includes(userId)) {
      winners.push(userId);
    }

    // Determine next turn
    let nextTurn = userId;
    let shouldGetAnotherTurn = stepsToMove === 6 || bonusRoll || tokenReachedFinish;
    if (allTokensFinished) {
      shouldGetAnotherTurn = false;
    }
    if (!shouldGetAnotherTurn) {
      const roomForTurn = {
        ...room,
        winners,
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
      };
      nextTurn = _getNextActiveTeamPlayer(roomForTurn, userId);
    }

    console.log(`🔄 [TEAM UP BACKEND] Next turn: ${nextTurn} (steps: ${stepsToMove}, kills: ${killedTokens.length})`);

    const gameFinished = winners.length >= Object.keys(room.players || {}).length - 1;

    // Update room
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_result: null,
        dice_state: 'waiting',
        winners: winners,
        game_state: gameFinished ? 'finished' : 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) {
      console.log(`❌ [TEAM UP BACKEND] Update error: ${updateError.message}`);
      throw updateError;
    }

    console.log(`✅ [TEAM UP BACKEND] Token moved successfully`);
    res.json({ 
      success: true, 
      room: updatedRoom,
      killedTokens,
      bonusRoll,
      newPosition: newPos
    });
  } catch (error) {
    console.log(`❌ [TEAM UP BACKEND] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ⚠️ DISABLED: Bot AI is now handled by botPlayerService.js
// This duplicate handler was causing flickering and double animations
// DO NOT RE-ENABLE - use botPlayerService.js instead
/*
async function handleBotTurn(roomId, botUserId) {
  // DISABLED - see botPlayerService.js
}
*/

// Trigger bot turn - DISABLED (bots auto-trigger via botPlayerService.js)
router.post('/:roomId/trigger-bot', async (req, res) => {
  // Bot turns are now handled automatically by botPlayerService.js
  // This endpoint is kept for backwards compatibility but does nothing
  res.json({ 
    success: true, 
    message: 'Bot turns are now handled automatically by botPlayerService.js',
    deprecated: true 
  });
});

// ============================================
// BOT ENDPOINTS (No auth required - bot sends its own ID)
// ============================================

// ❌ DISABLED: Bot routes cause conflicts with realtime bot system
// These routes are disabled to prevent multiple bot systems from interfering
/*
// Bot Roll Dice (Optimized - No database queries needed!)
router.post('/:roomId/bot-roll-dice', async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] ===== REQUEST START ===== at ${new Date().toISOString()}`);
  console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Room ID: ${req.params.roomId}`);
  console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Bot User ID: ${req.body.botUserId}`);
  
  try {
    const { roomId } = req.params;
    const { botUserId, gameMode, gameRoom } = req.body;

    // Step 1: Validate input
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 1: Validating input...`);
    const step1Start = Date.now();

    if (!botUserId) {
      console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 1 FAILED: botUserId is required`);
      return res.status(400).json({ error: 'botUserId is required' });
    }

    if (gameMode && gameRoom) {
      console.log(`🚀 [TEAM UP BOT ROLL ${requestId}] OPTIMIZED: Using provided gameRoom data (no database query needed!)`);
      console.log(`🚀 [TEAM UP BOT ROLL ${requestId}] Game mode: ${gameMode}`);
    } else {
      console.log(`⚠️ [TEAM UP BOT ROLL ${requestId}] FALLBACK: gameMode/gameRoom not provided, will query database`);
    }

    const step1End = Date.now();
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 1 complete: Input validation took ${step1End - step1Start}ms`);

    // Step 2: Get room data (use provided or fallback to database query)
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 2: Getting room data...`);
    const step2Start = Date.now();

    let room;
    if (gameRoom) {
      // Use provided room data (OPTIMIZED)
      room = gameRoom;
      console.log(`🚀 [TEAM UP BOT ROLL ${requestId}] Using provided room data - eliminated database query!`);
    } else {
      // Fallback to database query
      console.log(`🔍 [TEAM UP BOT ROLL ${requestId}] Querying database for room...`);
      const { data: fetchedRoom, error: fetchError } = await supabaseAdmin
        .from('team_up_rooms')
        .select('*')
        .eq('room_id', roomId)
        .single();

      if (fetchError || !fetchedRoom) {
        console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 2 FAILED: Room not found`);
        return res.status(404).json({ error: 'Room not found' });
      }
      room = fetchedRoom;
    }

    const step2End = Date.now();
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 2 complete: Get room data took ${step2End - step2Start}ms`);

    // Step 3: Validate game state
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 3: Validating game state...`);
    const step3Start = Date.now();

    if (room.turn !== botUserId) {
      console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 3 FAILED: Not bot turn. Current: ${room.turn}, Bot: ${botUserId}`);
      return res.status(403).json({ error: 'Not bot turn' });
    }

    if (room.game_state !== 'playing') {
      console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 3 FAILED: Game not playing. State: ${room.game_state}`);
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    const pendingSteps = room.pending_steps || {};
    if (pendingSteps[botUserId] && pendingSteps[botUserId] > 0) {
      console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 3 FAILED: Bot has pending steps: ${pendingSteps[botUserId]}`);
      return res.status(400).json({ error: 'Bot must move a token first' });
    }

    const step3End = Date.now();
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 3 complete: Game state validation took ${step3End - step3Start}ms`);

    // Step 4: Generate dice result
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 4: Generating dice result...`);
    const step4Start = Date.now();

    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Dice result: ${diceResult}`);

    const step4End = Date.now();
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 4 complete: Generated dice ${diceResult}, took ${step4End - step4Start}ms`);

    // Step 5: Handle consecutive sixes logic
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 5: Checking consecutive sixes...`);
    const step5Start = Date.now();

    const consecutiveSixes = room.consecutive_sixes || {};
    let currentCount = consecutiveSixes[botUserId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    if (currentCount >= 3) {
      console.log(`⚠️ [TEAM UP BOT ROLL ${requestId}] 3 consecutive 6s! Cancelling turn`);
      const updatedConsecutiveSixes = { ...consecutiveSixes, [botUserId]: 0 };
      const nextTurn = getNextTeamTurn(room.players, botUserId);
      
      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          consecutive_sixes: updatedConsecutiveSixes,
          turn: nextTurn,
          dice_result: null,
          dice_state: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      const step5End = Date.now();
      const totalTime = Date.now() - requestStartTime;
      console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 5 complete: Consecutive sixes check took ${step5End - step5Start}ms`);
      console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] ===== REQUEST COMPLETE (TURN CANCELLED) ===== Total time: ${totalTime}ms`);
      
      return res.json({ success: true, turnCancelled: true, room: updatedRoom });
    }

    const step5End = Date.now();
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 5 complete: Consecutive sixes check took ${step5End - step5Start}ms`);

    // Step 6: Update database
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 6: Updating database...`);
    const step6Start = Date.now();

    const updatedConsecutiveSixes = { ...consecutiveSixes, [botUserId]: currentCount };

    // Optimized: Update without .select() to avoid extra round-trip
    const { error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        consecutive_sixes: updatedConsecutiveSixes,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    const step6End = Date.now();
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 6 complete: Database update took ${step6End - step6Start}ms`);

    if (updateError) {
      console.log(`❌ [TEAM UP BOT ROLL ${requestId}] Step 6 FAILED: Database update error:`, updateError);
      throw updateError;
    }

    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Database updated successfully`);

    // Step 7: Send response
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Step 7: Sending response...`);
    const step7Start = Date.now();

    // Return the room with updated dice values
    const updatedGameRoom = {
      ...room,
      dice_result: diceResult,
      dice_state: 'rolling',
      consecutive_sixes: updatedConsecutiveSixes
    };

    const response = { success: true, diceResult, room: updatedGameRoom };
    res.json(response);

    const step7End = Date.now();
    const totalTime = Date.now() - requestStartTime;
    
    console.log(`✅ [TEAM UP BOT ROLL ${requestId}] Step 7 complete: Response sent, took ${step7End - step7Start}ms`);
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] ===== REQUEST COMPLETE ===== Total time: ${totalTime}ms`);
    console.log(`🎲 [TEAM UP BOT ROLL ${requestId}] Breakdown:`);
    console.log(`   - Input validation: ${step1End - step1Start}ms`);
    console.log(`   - Get room data: ${step2End - step2Start}ms`);
    console.log(`   - Game state validation: ${step3End - step3Start}ms`);
    console.log(`   - Generate dice: ${step4End - step4Start}ms`);
    console.log(`   - Consecutive sixes check: ${step5End - step5Start}ms`);
    console.log(`   - Database update: ${step6End - step6Start}ms`);
    console.log(`   - Send response: ${step7End - step7Start}ms`);
    if (gameRoom) {
      console.log(`🚀 [TEAM UP BOT ROLL ${requestId}] OPTIMIZATION: Eliminated database query! Saved ~50-1000ms`);
    }
    
  } catch (error) {
    const totalTime = Date.now() - requestStartTime;
    console.error(`❌ [TEAM UP BOT ROLL ${requestId}] ERROR after ${totalTime}ms:`, error);
    console.error(`❌ [TEAM UP BOT ROLL ${requestId}] Error stack:`, error.stack);
    res.status(500).json({ error: error.message });
  }
});

// ❌ DISABLED: Bot Complete Dice route
/*
router.post('/:roomId/bot-complete-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    console.log(`🤖 [BOT] Complete dice - Room: ${roomId}, Bot: ${botUserId}`);

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    const diceResult = room.dice_result || 0;
    const playerColor = room.players[botUserId];
    const playerPositions = room.positions[playerColor] || {};

    console.log(`🔍 [BOT] Checking valid moves for ${playerColor}, dice: ${diceResult}`);

    const validMove = hasValidMoves(playerPositions, diceResult);

    if (!validMove) {
      const nextTurn = getNextTeamTurn(room.players, botUserId);
      const consecutiveSixes = room.consecutive_sixes || {};
      if (diceResult !== 6) consecutiveSixes[botUserId] = 0;

      console.log(`⏭️ [BOT] No valid moves, passing turn to: ${nextTurn}`);

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
          consecutive_sixes: consecutiveSixes,
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ success: true, noValidMoves: true, room: updatedRoom });
    }

    const pendingSteps = room.pending_steps || {};
    pendingSteps[botUserId] = diceResult;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ [BOT] Dice completed, pending steps: ${diceResult}`);
    res.json({ success: true, room: updatedRoom });
  } catch (error) {
    console.error('Error completing dice for bot:', error);
    res.status(500).json({ error: error.message });
  }
});
*/

// ❌ DISABLED: Bot Move Token route
/*
router.post('/:roomId/bot-move-token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId, tokenId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    console.log(`🤖 [BOT] Move token - Room: ${roomId}, Bot: ${botUserId}, Token: ${tokenId}`);

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    const pendingSteps = room.pending_steps || {};
    const stepsToMove = pendingSteps[botUserId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    // Parse token (format: "color:tokenName")
    const [color, tokenName] = tokenId.split(':');
    if (!color || !tokenName) {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    if (room.players[botUserId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to this bot' });
    }

    const currentPosition = room.positions[color]?.[tokenName];
    if (currentPosition === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    if (currentPosition === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }

    let newPosition = currentPosition === 0 ? 1 : currentPosition + stepsToMove;

    if (newPosition > 61) {
      return res.status(400).json({ error: 'Need exact dice count to enter home' });
    }

    console.log(`🚀 [BOT] Moving ${color} ${tokenName} from ${currentPosition} to ${newPosition}`);

    // Update position
    const updatedPositions = { ...room.positions };
    if (!updatedPositions[color]) updatedPositions[color] = {};
    updatedPositions[color] = { ...updatedPositions[color], [tokenName]: newPosition };

    // Check for kills using grid coordinates (opponent team only)
    let bonusRoll = false;
    const noOfPlayers = 4;
    
    // Get grid position of moving token
    const movingTokenGridPos = getBoardPosition(color, newPosition, noOfPlayers);
    
    // CORRECT safe positions for 4-player board
    const safePositions = [9, 17, 22, 30, 35, 43, 48, 56];
    const isOnSafeSpot = safePositions.includes(newPosition);
    
    if (!isOnSafeSpot && newPosition > 0 && newPosition < 61 && movingTokenGridPos) {
      for (const [otherColor, otherTokens] of Object.entries(updatedPositions)) {
        if (otherColor === color) continue;
        
        // Check if same team (Team A: red+blue, Team B: green+yellow)
        const isTeamA = ['red', 'blue'].includes(color);
        const otherIsTeamA = ['red', 'blue'].includes(otherColor);
        if (isTeamA === otherIsTeamA) continue; // Skip teammate
        
        for (const [otherTokenName, otherPos] of Object.entries(otherTokens)) {
          if (otherPos <= 0 || otherPos >= 61) continue; // Skip home and finish
          
          // Get grid position of opponent token
          const opponentGridPos = getBoardPosition(otherColor, otherPos, noOfPlayers);
          
          // Compare grid coordinates
          if (opponentGridPos && movingTokenGridPos.pos[0] === opponentGridPos.pos[0] && 
              movingTokenGridPos.pos[1] === opponentGridPos.pos[1]) {
            // Kill opponent token
            updatedPositions[otherColor] = { ...updatedPositions[otherColor], [otherTokenName]: 0 };
            bonusRoll = true;
            console.log(`💀 [BOT] ${color} ${tokenName} (grid: [${movingTokenGridPos.pos}]) killed ${otherColor} ${otherTokenName} (grid: [${opponentGridPos.pos}])`);
          }
        }
      }
    }

    // Clear pending steps
    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[botUserId];

    // Check if token reached finish position (bonus turn)
    const tokenReachedFinish = newPosition === 61;
    if (tokenReachedFinish) {
      console.log(`🏠 [BOT] Token reached finish! Bot gets bonus turn.`);
    }

    // Determine next turn
    let nextTurn = botUserId;
    // Bot keeps turn if: rolled 6, killed opponent, OR token reached finish
    const shouldGetAnotherTurn = stepsToMove === 6 || bonusRoll || tokenReachedFinish;
    
    if (!shouldGetAnotherTurn) {
      nextTurn = getNextTeamTurn(room.players, botUserId);
    }

    // Reset consecutive sixes when turn passes
    const consecutiveSixes = room.consecutive_sixes || {};
    if (nextTurn !== botUserId) {
      consecutiveSixes[botUserId] = 0;
    }

    console.log(`🔄 [BOT] Next turn: ${nextTurn}`);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_result: null,
        dice_state: 'waiting',
        consecutive_sixes: consecutiveSixes,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ [BOT] Move complete`);
    res.json({ success: true, room: updatedRoom, bonusRoll });
  } catch (error) {
    console.error('Error moving token for bot:', error);
    res.status(500).json({ error: error.message });
  }
});
*/

// ============================================
// PLAYER LEAVE/DISCONNECT HANDLING
// ============================================

// Helper: Check if user is a bot
function isBot(userId) {
  return userId && userId.startsWith('00000000-');
}

// Helper: Get next active player (skip escaped players)
function getNextActivePlayer(players, escapedPlayers, currentUserId) {
  const turnOrder = ['red', 'green', 'blue', 'yellow'];
  const currentColor = players[currentUserId];
  
  if (!currentColor) return null;
  
  const currentIndex = turnOrder.indexOf(currentColor);
  if (currentIndex === -1) return null;
  
  // Try each player in turn order
  for (let i = 1; i <= 4; i++) {
    const nextIndex = (currentIndex + i) % turnOrder.length;
    const nextColor = turnOrder[nextIndex];
    
    // Find userId with next color
    for (const [userId, color] of Object.entries(players)) {
      if (color === nextColor && !escapedPlayers.includes(userId)) {
        return userId;
      }
    }
  }
  
  return null;
}

// Helper: Check if all remaining players are bots
function areAllRemainingPlayersBots(players, escapedPlayers) {
  for (const [userId, color] of Object.entries(players)) {
    if (!escapedPlayers.includes(userId) && !isBot(userId)) {
      return false; // Found a real player
    }
  }
  return true; // All remaining are bots
}

// Import bot service
import { startBotPlayersForRoom, stopBotPlayersForRoom } from '../services/botPlayerService.js';

// Start Game - Initialize game and start bot service
router.post('/:roomId/start-game', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🎮 [START GAME] Starting game in room ${roomId}`);

    // Get room
    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if room is full
    const totalPlayers = room.team_a.length + room.team_b.length;
    if (totalPlayers < 4) {
      return res.status(400).json({ error: 'Room is not full yet' });
    }

    // Check if game already started
    if (room.game_state === 'playing') {
      return res.status(400).json({ error: 'Game already started' });
    }

    // Assign colors to players
    const players = {};
    if (room.team_a[0]) players[room.team_a[0]] = 'red';
    if (room.team_a[1]) players[room.team_a[1]] = 'blue';
    if (room.team_b[0]) players[room.team_b[0]] = 'green';
    if (room.team_b[1]) players[room.team_b[1]] = 'yellow';

    // Set first turn (red always starts)
    const firstTurn = room.team_a[0];

    // Update room to playing state
    const { error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        game_state: 'playing',
        players: players,
        turn: firstTurn,
        dice_state: 'waiting',
        status: 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    if (updateError) throw updateError;

    console.log(`✅ [START GAME] Game started in room ${roomId}`);
    console.log(`   Players: ${JSON.stringify(players)}`);
    console.log(`   First turn: ${firstTurn}`);

    // Start bot players for this room (they will subscribe and play autonomously)
    try {
      const startedBots = await startBotPlayersForRoom(roomId);
      console.log(`🤖 [START GAME] Started ${startedBots.length} bot players for room ${roomId}`);
    } catch (botError) {
      console.error(`⚠️ [START GAME] Failed to start bot players:`, botError);
      // Don't fail the request, game can still work
    }

    res.json({
      success: true,
      message: 'Game started',
      players,
      firstTurn,
    });
  } catch (error) {
    console.error(`❌ [START GAME] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Intentional Leave - Player confirms leaving the game
router.post('/:roomId/leave-game', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🚪 [LEAVE] Player ${userId} leaving room ${roomId}`);

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // If game hasn't started, just remove player from waiting room
    if (room.game_state !== 'playing') {
      console.log(`🚪 [LEAVE] Game not started, removing from waiting room`);
      
      let updatedTeamA = [...(room.team_a || [])].filter(id => id !== userId);
      let updatedTeamB = [...(room.team_b || [])].filter(id => id !== userId);
      let updatedPlayers = { ...room.players };
      delete updatedPlayers[userId];
      
      // If room is empty, delete it
      if (Object.keys(updatedPlayers).length === 0) {
        await supabaseAdmin.from('team_up_rooms').delete().eq('room_id', roomId);
        return res.json({ success: true, roomDeleted: true });
      }
      
      await supabaseAdmin
        .from('team_up_rooms')
        .update({
          team_a: updatedTeamA,
          team_b: updatedTeamB,
          players: updatedPlayers,
          status: 'open',
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId);
      
      return res.json({ success: true, leftWaitingRoom: true });
    }

    // Game is in progress - handle intentional leave
    const playerColor = room.players[userId];
    if (!playerColor) {
      return res.status(400).json({ error: 'Player not in this room' });
    }

    // Add to escaped players
    let escapedPlayers = [...(room.escaped_players || [])];
    if (!escapedPlayers.includes(userId)) {
      escapedPlayers.push(userId);
    }

    // Remove player's tokens from board (set all to 0)
    let updatedPositions = { ...room.positions };
    if (updatedPositions[playerColor]) {
      updatedPositions[playerColor] = {
        tokenA: 0,
        tokenB: 0,
        tokenC: 0,
        tokenD: 0,
      };
    }

    // Check if all remaining players are bots
    const allRemainingAreBots = areAllRemainingPlayersBots(room.players, escapedPlayers);
    
    if (allRemainingAreBots) {
      // Delete the room entirely
      console.log(`🗑️ [LEAVE] All remaining players are bots, deleting room`);
      await supabaseAdmin.from('team_up_rooms').delete().eq('room_id', roomId);
      return res.json({ success: true, roomDeleted: true, reason: 'all_bots_remaining' });
    }

    // Pass turn if it was this player's turn
    let nextTurn = room.turn;
    let diceState = room.dice_state;
    let diceResult = room.dice_result;
    
    // Clear pending steps for leaving player
    let updatedPendingSteps = { ...room.pending_steps };
    delete updatedPendingSteps[userId];

    const roomForTurn = {
      ...room,
      escaped_players: escapedPlayers,
      positions: updatedPositions,
      pending_steps: updatedPendingSteps,
    };

    if (room.turn === userId) {
      nextTurn = _getNextActiveTeamPlayer(roomForTurn, userId);
      // Reset dice state when passing turn due to leave
      diceState = 'waiting';
      diceResult = null;
      console.log(`🔄 [LEAVE] Passing turn from ${userId} to ${nextTurn}, resetting dice state`);
    } else if (nextTurn && !_isPlayerActiveInRoom(roomForTurn, nextTurn)) {
      nextTurn = _getNextActiveTeamPlayer(roomForTurn, nextTurn);
      diceState = 'waiting';
      diceResult = null;
      console.log(`🔄 [LEAVE] Current turn became inactive, passing turn to ${nextTurn}`);
    }

    // Check if game should end (only one team left)
    const teamAActive = (room.team_a || []).filter(id => !escapedPlayers.includes(id));
    const teamBActive = (room.team_b || []).filter(id => !escapedPlayers.includes(id));
    
    let gameState = room.game_state;
    let winners = room.winners || [];
    
    if (teamAActive.length === 0 && teamBActive.length > 0) {
      // Team B wins
      gameState = 'finished';
      winners = teamBActive;
      console.log(`🏆 [LEAVE] Team B wins by forfeit`);
    } else if (teamBActive.length === 0 && teamAActive.length > 0) {
      // Team A wins
      gameState = 'finished';
      winners = teamAActive;
      console.log(`🏆 [LEAVE] Team A wins by forfeit`);
    }

    // Update room
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        escaped_players: escapedPlayers,
        positions: updatedPositions,
        turn: nextTurn,
        dice_state: diceState,
        dice_result: diceResult,
        pending_steps: updatedPendingSteps,
        game_state: gameState,
        winners: winners,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ [LEAVE] Player ${userId} (${playerColor}) left successfully`);
    res.json({ 
      success: true, 
      room: updatedRoom,
      playerColor,
      gameEnded: gameState === 'finished',
    });
  } catch (error) {
    console.error('Error leaving game:', error);
    res.status(500).json({ error: error.message });
  }
});

// Player Disconnect - Mark player as disconnected (bot takes over)
router.post('/:roomId/player-disconnect', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`📡 [DISCONNECT] Player ${userId} disconnected from room ${roomId}`);

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.game_state !== 'playing') {
      return res.json({ success: true, message: 'Game not in progress' });
    }

    // Add to disconnected players list
    let disconnectedPlayers = [...(room.disconnected_players || [])];
    if (!disconnectedPlayers.includes(userId)) {
      disconnectedPlayers.push(userId);
    }

    _clearDisconnectRemovalTimer(roomId, userId);

    // Update room with disconnected player (bot will take over their turns)
    await supabaseAdmin
      .from('team_up_rooms')
      .update({
        disconnected_players: disconnectedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    const timerKey = `${roomId}:${userId}`;
    disconnectRemovalTimers.set(
      timerKey,
      setTimeout(() => {
        _finalizeDisconnectRemoval(roomId, userId).catch((e) => {
          console.error('Error finalizing disconnect removal:', e);
        });
      }, DISCONNECT_GRACE_MS),
    );

    console.log(`✅ [DISCONNECT] Player ${userId} marked as disconnected, bot will take over`);
    res.json({ success: true, botTakeover: true });
  } catch (error) {
    console.error('Error handling disconnect:', error);
    res.status(500).json({ error: error.message });
  }
});

// Player Reconnect - Player comes back online
router.post('/:roomId/player-reconnect', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🔌 [RECONNECT] Player ${userId} reconnecting to room ${roomId}`);

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if player was in this room
    if (!room.players[userId]) {
      return res.status(400).json({ error: 'Player not in this room' });
    }

    // Check if player has escaped (can't reconnect after intentional leave)
    if ((room.escaped_players || []).includes(userId)) {
      return res.status(400).json({ error: 'Cannot reconnect after leaving game' });
    }

    // Remove from disconnected players
    let disconnectedPlayers = [...(room.disconnected_players || [])].filter(id => id !== userId);

    _clearDisconnectRemovalTimer(roomId, userId);

    // Update room
    await supabaseAdmin
      .from('team_up_rooms')
      .update({
        disconnected_players: disconnectedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    console.log(`✅ [RECONNECT] Player ${userId} reconnected successfully`);
    res.json({ success: true, room });
  } catch (error) {
    console.error('Error handling reconnect:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn timeout (client-side timer expired)
router.post('/:roomId/turn-timeout', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.game_state !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    if (room.turn !== userId) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    // Disconnected players are bot-controlled; do not penalize with timeout misses.
    if ((room.disconnected_players || []).includes(userId)) {
      return res.json({ success: true, room, ignored: true, reason: 'disconnected_bot_takeover' });
    }

    const timeoutMisses = { ...(room.timeout_misses || {}) };
    const currentMisses = Number(timeoutMisses[userId] || 0);
    const nextMisses = currentMisses + 1;
    timeoutMisses[userId] = nextMisses;

    const kickedPlayers = [...(room.kicked_players || [])];
    const escapedPlayers = [...(room.escaped_players || [])];

    const shouldKick = nextMisses >= 6;
    if (shouldKick) {
      if (!kickedPlayers.includes(userId)) kickedPlayers.push(userId);
      if (!escapedPlayers.includes(userId)) escapedPlayers.push(userId);
    }

    const updatedPendingSteps = { ...(room.pending_steps || {}) };
    delete updatedPendingSteps[userId];

    const roomForTurn = {
      ...room,
      escaped_players: escapedPlayers,
      kicked_players: kickedPlayers,
      pending_steps: updatedPendingSteps,
      timeout_misses: timeoutMisses,
    };

    const nextTurn = _getNextActiveTeamPlayer(roomForTurn, userId);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        timeout_misses: timeoutMisses,
        kicked_players: kickedPlayers,
        escaped_players: escapedPlayers,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      room: updatedRoom,
      kicked: shouldKick,
      timeoutMisses: nextMisses,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if player should be controlled by bot (for turn handling)
router.get('/:roomId/should-bot-play/:userId', async (req, res) => {
  try {
    const { roomId, userId } = req.params;

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const disconnectedPlayers = room.disconnected_players || [];
    const shouldBotPlay = disconnectedPlayers.includes(userId) || isBot(userId);

    res.json({ shouldBotPlay, isDisconnected: disconnectedPlayers.includes(userId) });
  } catch (error) {
    console.error('Error checking bot play:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:roomId/distribute-winner-rewards', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.players?.[userId]) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (room.game_state !== 'finished') {
      return res.json({ success: true, skipped: true, reason: 'not_finished' });
    }

    const winners = room.winners || [];
    if (!winners.length) {
      return res.json({ success: true, skipped: true, reason: 'no_winners' });
    }

    const entryFee = Number(room.entry_fee ?? 0);
    const winAmount = entryFee * 2;
    if (!winAmount) {
      return res.json({ success: true, skipped: true, reason: 'no_entry_fee' });
    }

    const firstWinner = winners[0];
    const teamA = room.team_a || [];
    const teamB = room.team_b || [];
    const winningTeam = teamA.includes(firstWinner)
      ? teamA
      : teamB.includes(firstWinner)
      ? teamB
      : [];

    if (!winningTeam.length) {
      return res.json({ success: true, skipped: true, reason: 'no_winning_team' });
    }

    const { data: payoutLock, error: lockError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        payout_processed: true,
        payout_processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .eq('payout_processed', false)
      .select('room_id')
      .single();

    if (lockError) {
      if (lockError.code === 'PGRST116') {
        return res.json({ success: true, alreadyProcessed: true, paid: [] });
      }
      throw lockError;
    }

    if (!payoutLock) {
      return res.json({ success: true, alreadyProcessed: true, paid: [] });
    }

    const isBotId = (id) => id && (id.startsWith('00000000-') || id.startsWith('bot_'));
    const paid = [];

    for (const winnerId of winningTeam) {
      if (isBotId(winnerId)) continue;

      const { error: rpcError } = await supabaseAdmin.rpc('add_coins', {
        p_user_id: String(winnerId),
        p_amount: winAmount,
      });

      if (rpcError) {
        const { data: currentUser, error: fetchErr } = await supabaseAdmin
          .from('users')
          .select('total_coins')
          .eq('uid', winnerId)
          .single();

        if (fetchErr) throw fetchErr;

        const currentCoins = Number(currentUser?.total_coins ?? 0);
        const { error: updErr } = await supabaseAdmin
          .from('users')
          .update({ total_coins: currentCoins + winAmount })
          .eq('uid', winnerId);

        if (updErr) throw updErr;
      }

      paid.push({ userId: winnerId, amount: winAmount });
    }

    return res.json({ success: true, paid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:roomId/exit', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { data: room, error: fetchError } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.players?.[userId]) {
      return res.status(400).json({ error: 'Player not in this room' });
    }

    const exitedPlayers = [...(room.exited_players || [])];
    if (!exitedPlayers.includes(userId)) exitedPlayers.push(userId);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        exited_players: exitedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    const isBotId = (id) => id && (id.startsWith('00000000-') || id.startsWith('bot_'));
    const expectedHumanIds = Object.keys(room.players || {}).filter((id) => !isBotId(id));
    const allHumansExited = expectedHumanIds.every((id) => exitedPlayers.includes(id));

    if (updatedRoom.game_state === 'finished' && allHumansExited) {
      await supabaseAdmin.from('team_up_rooms').delete().eq('room_id', roomId);
      return res.json({ success: true, roomDeleted: true });
    }

    return res.json({ success: true, room: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
