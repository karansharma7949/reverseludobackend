import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import { getBoardPosition } from '../utils/gameHelpers.js';

const router = express.Router();

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
      const nextTurn = getNextTeamTurn(room.players, userId);
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
    const { tokenId } = req.body;
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

    // Check pending steps
    const pendingSteps = room.pending_steps || {};
    const stepsToMove = pendingSteps[userId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      console.log(`❌ [TEAM UP BACKEND] No pending steps for user ${userId}`);
      return res.status(400).json({ error: 'No pending steps to move' });
    }

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

    // Check if can move from home
    if (currentPos === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }
    
    // Calculate new position
    let newPos = currentPos === 0 ? 1 : currentPos + stepsToMove;
    
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
    const starPositions = [1, 9, 14, 22, 27, 35, 40, 48]; // Safe positions for 4-player
    const isOnSafeSpot = starPositions.includes(newPos);
    
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

    // Determine next turn
    let nextTurn = userId;
    // Player keeps turn if: rolled 6, killed opponent, OR token reached finish
    const shouldGetAnotherTurn = stepsToMove === 6 || bonusRoll || tokenReachedFinish;
    
    if (!shouldGetAnotherTurn) {
      // Get next player in turn order
      const playerIds = Object.keys(room.players);
      const currentIndex = playerIds.indexOf(userId);
      const nextIndex = (currentIndex + 1) % playerIds.length;
      nextTurn = playerIds[nextIndex];
    }

    console.log(`🔄 [TEAM UP BACKEND] Next turn: ${nextTurn} (steps: ${stepsToMove}, kills: ${killedTokens.length})`);

    // Update room
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_result: null,
        dice_state: 'waiting',
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

// Bot AI - Handle bot turn
async function handleBotTurn(roomId, botUserId) {
  console.log(`🤖 [BOT AI] Handling bot turn for ${botUserId} in room ${roomId}`);
  
  try {
    // Get room
    const { data: room } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (!room || room.turn !== botUserId || room.dice_state !== 'waiting') {
      console.log(`❌ [BOT AI] Not bot's turn or dice not waiting. Turn: ${room?.turn}, State: ${room?.dice_state}`);
      return;
    }

    // Wait a bit for realism
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Roll dice
    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 [BOT AI] Bot rolled: ${diceResult}`);

    await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    // Wait for dice animation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get updated room
    const { data: updatedRoom } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (!updatedRoom) return;

    const botColor = updatedRoom.players[botUserId];
    const botPositions = updatedRoom.positions[botColor] || {};

    // Check for valid moves
    const validMoves = [];
    for (const [tokenName, pos] of Object.entries(botPositions)) {
      if (pos === 0 && diceResult === 6) {
        validMoves.push({ tokenName, from: 0, to: 1, priority: 10 });
      } else if (pos > 0 && pos < 61) {
        const newPos = pos + diceResult;
        if (newPos <= 61) {
          // Higher priority for tokens closer to finish
          const priority = pos > 50 ? 8 : pos > 30 ? 5 : 3;
          validMoves.push({ tokenName, from: pos, to: newPos, priority });
        }
      }
    }

    if (validMoves.length === 0) {
      // No valid moves - pass turn
      console.log(`⏭️ [BOT AI] No valid moves, passing turn`);
      const nextTurn = getNextTeamTurn(updatedRoom.players, botUserId);
      
      await supabaseAdmin
        .from('team_up_rooms')
        .update({
          turn: nextTurn,
          dice_result: null,
          dice_state: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId);
      
      console.log(`✅ [BOT AI] Turn passed to ${nextTurn}`);
      return;
    }

    // Sort by priority and pick best move
    validMoves.sort((a, b) => b.priority - a.priority);
    const bestMove = validMoves[0];

    console.log(`🎯 [BOT AI] Bot moving ${botColor} ${bestMove.tokenName} from ${bestMove.from} to ${bestMove.to}`);

    // Set pending steps (complete dice)
    const pendingSteps = { ...updatedRoom.pending_steps };
    pendingSteps[botUserId] = diceResult;

    await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    // Wait a bit before moving
    await new Promise(resolve => setTimeout(resolve, 800));

    // Move token
    const positions = { ...updatedRoom.positions };
    if (!positions[botColor]) positions[botColor] = {};
    positions[botColor] = { ...positions[botColor], [bestMove.tokenName]: bestMove.to };

    // Check for kills
    const killedTokens = [];
    let bonusRoll = false;
    
    for (const [otherColor, otherTokens] of Object.entries(positions)) {
      if (otherColor === botColor) continue;
      
      const isTeamA = ['red', 'blue'].includes(botColor);
      const otherIsTeamA = ['red', 'blue'].includes(otherColor);
      if (isTeamA === otherIsTeamA) continue;
      
      for (const [otherTokenName, otherPos] of Object.entries(otherTokens)) {
        if (otherPos === bestMove.to && otherPos > 0 && otherPos < 61) {
          positions[otherColor] = { ...positions[otherColor], [otherTokenName]: 0 };
          killedTokens.push(`${otherColor}:${otherTokenName}`);
          bonusRoll = true;
          console.log(`💀 [BOT AI] Bot killed ${otherColor} ${otherTokenName}`);
        }
      }
    }

    // Determine next turn
    let nextTurn = botUserId;
    const shouldGetAnotherTurn = diceResult === 6 || bonusRoll;
    
    if (!shouldGetAnotherTurn) {
      nextTurn = getNextTeamTurn(updatedRoom.players, botUserId);
    }

    console.log(`🔄 [BOT AI] Next turn: ${nextTurn} (dice: ${diceResult}, kills: ${killedTokens.length})`);

    // Clear pending steps
    const clearedPendingSteps = { ...pendingSteps };
    delete clearedPendingSteps[botUserId];

    await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions,
        pending_steps: clearedPendingSteps,
        turn: nextTurn,
        dice_result: null,
        dice_state: 'waiting',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);

    console.log(`✅ [BOT AI] Bot turn complete. Next turn: ${nextTurn}`);
  } catch (error) {
    console.log(`❌ [BOT AI] Error: ${error.message}`);
  }
}

// Trigger bot turn (called by frontend or realtime trigger)
router.post('/:roomId/trigger-bot', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const { data: room } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const currentPlayer = room.turn;
    
    // Check if current player is a bot
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('is_bot')
      .eq('uid', currentPlayer)
      .single();

    if (userData && userData.is_bot) {
      // Handle bot turn asynchronously
      handleBotTurn(roomId, currentPlayer);
      res.json({ success: true, message: 'Bot turn triggered' });
    } else {
      res.json({ success: true, message: 'Not a bot turn' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BOT ENDPOINTS (No auth required - bot sends its own ID)
// ============================================

// Bot Roll Dice
router.post('/:roomId/bot-roll-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    console.log(`🤖 [BOT] Roll dice - Room: ${roomId}, Bot: ${botUserId}`);

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

    if (room.game_state !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    const pendingSteps = room.pending_steps || {};
    if (pendingSteps[botUserId] && pendingSteps[botUserId] > 0) {
      return res.status(400).json({ error: 'Bot must move a token first' });
    }

    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 [BOT] Dice result: ${diceResult}`);

    const consecutiveSixes = room.consecutive_sixes || {};
    let currentCount = consecutiveSixes[botUserId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    if (currentCount >= 3) {
      console.log(`⚠️ [BOT] 3 consecutive 6s! Cancelling turn`);
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

      return res.json({ success: true, turnCancelled: true, room: updatedRoom });
    }

    const updatedConsecutiveSixes = { ...consecutiveSixes, [botUserId]: currentCount };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        consecutive_sixes: updatedConsecutiveSixes,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ [BOT] Dice rolled successfully`);
    res.json({ success: true, diceResult, room: updatedRoom });
  } catch (error) {
    console.error('Error rolling dice for bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bot Complete Dice
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

// Bot Move Token
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

    // Check for kills (opponent team only)
    let bonusRoll = false;
    
    for (const [otherColor, otherTokens] of Object.entries(updatedPositions)) {
      if (otherColor === color) continue;
      
      const isTeamA = ['red', 'blue'].includes(color);
      const otherIsTeamA = ['red', 'blue'].includes(otherColor);
      if (isTeamA === otherIsTeamA) continue;
      
      for (const [otherTokenName, otherPos] of Object.entries(otherTokens)) {
        if (otherPos === newPosition && otherPos > 0 && otherPos < 61) {
          updatedPositions[otherColor] = { ...updatedPositions[otherColor], [otherTokenName]: 0 };
          bonusRoll = true;
          console.log(`💀 [BOT] Killed ${otherColor} ${otherTokenName}`);
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

export default router;
