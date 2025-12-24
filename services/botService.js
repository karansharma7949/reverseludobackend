/**
 * Bot Service - Comprehensive Backend Bot System
 * 
 * This service handles all bot-related logic for Team Up mode:
 * - Realtime subscription to game rooms
 * - AI decision making for moves
 * - Automatic turn handling
 * - Proper game state management
 */

import { supabaseAdmin } from '../config/supabase.js';

// ============================================
// CONSTANTS
// ============================================

const FIXED_BOT_IDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
];

const TURN_ORDER = ['red', 'green', 'blue', 'yellow'];
const SAFE_POSITIONS = [9, 17, 22, 30, 35, 43, 48, 56]; // Correct safe positions
const HOME_STRETCH_START = 52;
const FINISH_POSITION = 57;

// Bot timing configuration (in milliseconds)
const BOT_TIMING = {
  ROLL_DELAY: 1500,      // Delay before rolling dice
  ANIMATION_DELAY: 2000, // Wait for dice animation
  MOVE_DELAY: 1000,      // Delay before moving token
  TURN_PASS_DELAY: 500,  // Delay before passing turn
};

// Active bot subscriptions
const activeSubscriptions = new Map();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a user ID is a bot
 */
function isBot(userId) {
  return FIXED_BOT_IDS.includes(userId);
}

/**
 * Get the next player in turn order
 */
function getNextTurn(players, currentUserId, finishedPlayers = []) {
  const currentColor = players[currentUserId];
  if (!currentColor) return null;

  const currentIndex = TURN_ORDER.indexOf(currentColor);
  if (currentIndex === -1) return null;

  // Try each player in order until we find one who hasn't finished
  for (let i = 1; i <= 4; i++) {
    const nextIndex = (currentIndex + i) % TURN_ORDER.length;
    const nextColor = TURN_ORDER[nextIndex];

    for (const [userId, color] of Object.entries(players)) {
      if (color === nextColor && !finishedPlayers.includes(userId)) {
        return userId;
      }
    }
  }

  return null;
}

/**
 * Check if a position is safe
 */
function isSafePosition(position) {
  return SAFE_POSITIONS.includes(position);
}

/**
 * Get grid position for a color at a given track position
 */
function getGridPosition(color, trackPosition) {
  // This maps track positions to actual grid coordinates
  // Simplified version - in production, use the full position mapping
  const colorOffsets = {
    red: 0,
    green: 13,
    yellow: 26,
    blue: 39,
  };
  
  if (trackPosition === 0) return 0; // Home
  if (trackPosition >= 52) return trackPosition; // Home stretch
  
  const offset = colorOffsets[color] || 0;
  return ((trackPosition - 1 + offset) % 52) + 1;
}

/**
 * Check if a token can be killed at a position
 */
function canKillAtPosition(position, color, allPositions) {
  if (position === 0 || isSafePosition(position)) return false;
  
  const gridPos = getGridPosition(color, position);
  
  for (const [otherColor, tokens] of Object.entries(allPositions)) {
    if (otherColor === color) continue;
    
    for (const [tokenName, tokenPos] of Object.entries(tokens)) {
      if (tokenPos > 0 && tokenPos < 52) {
        const otherGridPos = getGridPosition(otherColor, tokenPos);
        if (otherGridPos === gridPos) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Check if player has valid moves
 */
function hasValidMoves(positions, diceResult) {
  for (const [tokenName, pos] of Object.entries(positions)) {
    if (pos === 0 && diceResult === 6) return true;
    if (pos > 0 && pos < FINISH_POSITION) {
      const newPos = pos + diceResult;
      if (newPos <= FINISH_POSITION) return true;
    }
  }
  return false;
}

/**
 * Get all valid moves for a player
 */
function getValidMoves(positions, diceResult) {
  const validMoves = [];
  
  for (const [tokenName, pos] of Object.entries(positions)) {
    // Token at home - can only move with 6
    if (pos === 0 && diceResult === 6) {
      validMoves.push({
        tokenName,
        currentPos: pos,
        newPos: 1,
        type: 'exit_home',
      });
    }
    // Token on board
    else if (pos > 0 && pos < FINISH_POSITION) {
      const newPos = pos + diceResult;
      if (newPos <= FINISH_POSITION) {
        validMoves.push({
          tokenName,
          currentPos: pos,
          newPos,
          type: newPos === FINISH_POSITION ? 'finish' : 'move',
        });
      }
    }
  }
  
  return validMoves;
}

// ============================================
// BOT AI - DECISION MAKING
// ============================================

/**
 * Bot AI - Decide the best move
 * Priority:
 * 1. Kill opponent token
 * 2. Move token to finish
 * 3. Exit home with 6
 * 4. Move to safe position
 * 5. Move furthest token
 * 6. Random valid move
 */
function decideBestMove(validMoves, color, allPositions) {
  if (validMoves.length === 0) return null;
  if (validMoves.length === 1) return validMoves[0];

  // Score each move
  const scoredMoves = validMoves.map(move => {
    let score = 0;
    
    // Priority 1: Kill opponent (highest priority)
    if (canKillAtPosition(move.newPos, color, allPositions)) {
      score += 1000;
    }
    
    // Priority 2: Finish token
    if (move.type === 'finish') {
      score += 500;
    }
    
    // Priority 3: Exit home
    if (move.type === 'exit_home') {
      score += 300;
    }
    
    // Priority 4: Move to safe position
    if (isSafePosition(move.newPos)) {
      score += 200;
    }
    
    // Priority 5: Progress (further is better)
    score += move.newPos;
    
    // Priority 6: Avoid being killed (if currently safe, prefer staying safe)
    if (isSafePosition(move.currentPos) && !isSafePosition(move.newPos)) {
      score -= 50;
    }
    
    // Add some randomness to make bots less predictable
    score += Math.random() * 20;
    
    return { ...move, score };
  });

  // Sort by score (highest first)
  scoredMoves.sort((a, b) => b.score - a.score);
  
  return scoredMoves[0];
}

// ============================================
// BOT ACTIONS
// ============================================

/**
 * Bot rolls dice
 */
async function botRollDice(roomId, botUserId) {
  console.log(`🎲 [BOT SERVICE] Rolling dice for bot ${botUserId} in room ${roomId}`);
  
  try {
    // Generate dice result
    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 [BOT SERVICE] Dice result: ${diceResult}`);
    
    // Update room with dice result
    const { error } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'rolling',
        dice_result: diceResult,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    
    if (error) throw error;
    
    console.log(`✅ [BOT SERVICE] Dice rolled successfully: ${diceResult}`);
    return diceResult;
  } catch (error) {
    console.error(`❌ [BOT SERVICE] Error rolling dice:`, error);
    throw error;
  }
}

/**
 * Bot completes dice (after animation)
 */
async function botCompleteDice(roomId, botUserId, room) {
  console.log(`🎲 [BOT SERVICE] Completing dice for bot ${botUserId}`);
  
  try {
    const botColor = room.players[botUserId];
    const positions = room.positions[botColor];
    const diceResult = room.dice_result;
    
    // Check if bot has valid moves
    const hasValid = hasValidMoves(positions, diceResult);
    
    if (hasValid) {
      // Set pending steps
      const pendingSteps = { ...room.pending_steps, [botUserId]: diceResult };
      
      const { error } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          dice_state: 'complete',
          pending_steps: pendingSteps,
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId);
      
      if (error) throw error;
      console.log(`✅ [BOT SERVICE] Dice completed with pending steps: ${diceResult}`);
    } else {
      // No valid moves - pass turn
      const nextTurn = getNextTurn(room.players, botUserId, room.winners || []);
      
      const { error } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
          pending_steps: { ...room.pending_steps, [botUserId]: 0 },
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId);
      
      if (error) throw error;
      console.log(`✅ [BOT SERVICE] No valid moves, turn passed to ${nextTurn}`);
    }
  } catch (error) {
    console.error(`❌ [BOT SERVICE] Error completing dice:`, error);
    throw error;
  }
}

/**
 * Bot moves token
 */
async function botMoveToken(roomId, botUserId, room) {
  console.log(`🎯 [BOT SERVICE] Moving token for bot ${botUserId}`);
  
  try {
    const botColor = room.players[botUserId];
    const positions = room.positions[botColor];
    const pendingSteps = room.pending_steps[botUserId] || 0;
    
    if (pendingSteps === 0) {
      console.log(`⚠️ [BOT SERVICE] No pending steps for bot`);
      return;
    }
    
    // Get valid moves
    const validMoves = getValidMoves(positions, pendingSteps);
    
    if (validMoves.length === 0) {
      console.log(`⚠️ [BOT SERVICE] No valid moves available`);
      return;
    }
    
    // Decide best move using AI
    const bestMove = decideBestMove(validMoves, botColor, room.positions);
    console.log(`🎯 [BOT SERVICE] Best move: ${bestMove.tokenName} from ${bestMove.currentPos} to ${bestMove.newPos}`);
    
    // Update positions
    const newPositions = { ...room.positions };
    newPositions[botColor] = { ...newPositions[botColor], [bestMove.tokenName]: bestMove.newPos };
    
    // Check for kills
    let killedTokens = [];
    if (!isSafePosition(bestMove.newPos) && bestMove.newPos > 0 && bestMove.newPos < 52) {
      const gridPos = getGridPosition(botColor, bestMove.newPos);
      
      for (const [otherColor, tokens] of Object.entries(newPositions)) {
        if (otherColor === botColor) continue;
        
        for (const [tokenName, tokenPos] of Object.entries(tokens)) {
          if (tokenPos > 0 && tokenPos < 52) {
            const otherGridPos = getGridPosition(otherColor, tokenPos);
            if (otherGridPos === gridPos) {
              // Kill this token
              newPositions[otherColor][tokenName] = 0;
              killedTokens.push({ color: otherColor, token: tokenName });
              console.log(`💀 [BOT SERVICE] Killed ${otherColor} ${tokenName}!`);
            }
          }
        }
      }
    }
    
    // Check if bot finished
    let winners = [...(room.winners || [])];
    const allFinished = Object.values(newPositions[botColor]).every(pos => pos === FINISH_POSITION);
    if (allFinished && !winners.includes(botUserId)) {
      winners.push(botUserId);
      console.log(`🏆 [BOT SERVICE] Bot ${botUserId} finished! Position: ${winners.length}`);
    }
    
    // Determine next turn
    let nextTurn;
    const gotSix = pendingSteps === 6;
    const madeKill = killedTokens.length > 0;
    
    if ((gotSix || madeKill) && !allFinished) {
      // Bot gets another turn
      nextTurn = botUserId;
      console.log(`🔄 [BOT SERVICE] Bot gets another turn (six: ${gotSix}, kill: ${madeKill})`);
    } else {
      // Pass to next player
      nextTurn = getNextTurn(room.players, botUserId, winners);
    }
    
    // Check if game is finished
    const gameFinished = winners.length >= 3;
    
    // Update room
    const { error } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions: newPositions,
        pending_steps: { ...room.pending_steps, [botUserId]: 0 },
        dice_state: 'waiting',
        dice_result: null,
        turn: nextTurn,
        winners: winners,
        game_state: gameFinished ? 'finished' : 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    
    if (error) throw error;
    
    console.log(`✅ [BOT SERVICE] Token moved successfully. Next turn: ${nextTurn}`);
  } catch (error) {
    console.error(`❌ [BOT SERVICE] Error moving token:`, error);
    throw error;
  }
}

// ============================================
// BOT TURN HANDLER
// ============================================

/**
 * Handle bot turn - main entry point
 */
async function handleBotTurn(room) {
  const currentTurn = room.turn;
  
  if (!currentTurn || !isBot(currentTurn)) {
    return; // Not a bot's turn
  }
  
  // Check if player is disconnected (bot should play for them)
  const disconnectedPlayers = room.disconnected_players || [];
  const isDisconnectedPlayer = disconnectedPlayers.includes(currentTurn);
  
  if (!isBot(currentTurn) && !isDisconnectedPlayer) {
    return; // Real player who is not disconnected
  }
  
  const roomId = room.room_id;
  const diceState = room.dice_state;
  const pendingSteps = room.pending_steps?.[currentTurn] || 0;
  
  console.log(`🤖 [BOT SERVICE] Handling bot turn:`);
  console.log(`   Room: ${roomId}`);
  console.log(`   Bot: ${currentTurn}`);
  console.log(`   Dice State: ${diceState}`);
  console.log(`   Pending Steps: ${pendingSteps}`);
  
  try {
    // State 1: Waiting for dice roll
    if (diceState === 'waiting' && pendingSteps === 0) {
      console.log(`🎲 [BOT SERVICE] State 1: Rolling dice...`);
      await new Promise(resolve => setTimeout(resolve, BOT_TIMING.ROLL_DELAY));
      await botRollDice(roomId, currentTurn);
      return;
    }
    
    // State 2: Dice rolling (wait for animation, then complete)
    if (diceState === 'rolling') {
      console.log(`🎲 [BOT SERVICE] State 2: Completing dice after animation...`);
      await new Promise(resolve => setTimeout(resolve, BOT_TIMING.ANIMATION_DELAY));
      await botCompleteDice(roomId, currentTurn, room);
      return;
    }
    
    // State 3: Dice complete, has pending steps (move token)
    if (diceState === 'complete' && pendingSteps > 0) {
      console.log(`🎯 [BOT SERVICE] State 3: Moving token...`);
      await new Promise(resolve => setTimeout(resolve, BOT_TIMING.MOVE_DELAY));
      await botMoveToken(roomId, currentTurn, room);
      return;
    }
  } catch (error) {
    console.error(`❌ [BOT SERVICE] Error handling bot turn:`, error);
  }
}

// ============================================
// REALTIME SUBSCRIPTION
// ============================================

/**
 * Subscribe to a room for bot turns
 */
function subscribeToRoom(roomId) {
  if (activeSubscriptions.has(roomId)) {
    console.log(`⚠️ [BOT SERVICE] Already subscribed to room ${roomId}`);
    return;
  }
  
  console.log(`📡 [BOT SERVICE] Subscribing to room ${roomId}...`);
  
  const channel = supabaseAdmin
    .channel(`bot-room-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_up_rooms',
        filter: `room_id=eq.${roomId}`,
      },
      async (payload) => {
        console.log(`📡 [BOT SERVICE] Room ${roomId} updated`);
        
        if (payload.new) {
          const room = payload.new;
          
          // Only handle if game is playing
          if (room.game_state !== 'playing') {
            console.log(`⏸️ [BOT SERVICE] Game not playing, skipping bot turn`);
            return;
          }
          
          // Handle bot turn
          await handleBotTurn(room);
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 [BOT SERVICE] Subscription status for ${roomId}: ${status}`);
    });
  
  activeSubscriptions.set(roomId, channel);
  console.log(`✅ [BOT SERVICE] Subscribed to room ${roomId}`);
}

/**
 * Unsubscribe from a room
 */
async function unsubscribeFromRoom(roomId) {
  const channel = activeSubscriptions.get(roomId);
  
  if (channel) {
    await supabaseAdmin.removeChannel(channel);
    activeSubscriptions.delete(roomId);
    console.log(`✅ [BOT SERVICE] Unsubscribed from room ${roomId}`);
  }
}

/**
 * Start bot service for a room
 */
async function startBotService(roomId) {
  console.log(`🚀 [BOT SERVICE] Starting bot service for room ${roomId}`);
  
  // Subscribe to room updates
  subscribeToRoom(roomId);
  
  // Get current room state and handle if it's a bot's turn
  const { data: room, error } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  
  if (error) {
    console.error(`❌ [BOT SERVICE] Error fetching room:`, error);
    return;
  }
  
  if (room.game_state === 'playing') {
    await handleBotTurn(room);
  }
}

/**
 * Stop bot service for a room
 */
async function stopBotService(roomId) {
  console.log(`🛑 [BOT SERVICE] Stopping bot service for room ${roomId}`);
  await unsubscribeFromRoom(roomId);
}

// ============================================
// EXPORTS
// ============================================

export {
  isBot,
  FIXED_BOT_IDS,
  handleBotTurn,
  startBotService,
  stopBotService,
  subscribeToRoom,
  unsubscribeFromRoom,
  botRollDice,
  botCompleteDice,
  botMoveToken,
  decideBestMove,
  getValidMoves,
  hasValidMoves,
};

export default {
  isBot,
  FIXED_BOT_IDS,
  handleBotTurn,
  startBotService,
  stopBotService,
  subscribeToRoom,
  unsubscribeFromRoom,
};
