/**
 * Bot Player Service - SINGLE AUTHORITATIVE BOT SYSTEM
 * 
 * ⚠️ THIS IS THE ONLY BOT HANDLER - DO NOT CREATE DUPLICATES
 * 
 * Core Rules:
 * 1. ONE bot handler per room (no duplicates)
 * 2. ONE database update per action (atomic)
 * 3. State machine approach (idempotent)
 * 4. Frontend NEVER drives bot logic
 */

import { supabaseAdmin } from '../config/supabase.js';
import { positions4Player, positions5Player, positions6Player } from '../data/positions.js';
import { checkForKills, getStarPositions } from '../utils/gameHelpers.js';

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

const BOT_PROFILES = {
  '00000000-0000-0000-0000-000000000001': { name: 'Arjun', avatar: 'assets/images/avatars/avatarmale4.png' },
  '00000000-0000-0000-0000-000000000002': { name: 'Priya', avatar: 'assets/images/avatars/femaleavatar4.png' },
  '00000000-0000-0000-0000-000000000003': { name: 'Rahul', avatar: 'assets/images/avatars/avatarmale2.png' },
  '00000000-0000-0000-0000-000000000004': { name: 'Sneha', avatar: 'assets/images/avatars/femaleavatar2.png' },
  '00000000-0000-0000-0000-000000000005': { name: 'Vikram', avatar: 'assets/images/avatars/avatarmale3.png' },
  '00000000-0000-0000-0000-000000000006': { name: 'Ananya', avatar: 'assets/images/avatars/femaleavatar3.png' },
};

const TEAM_UP_TURN_ORDER = ['red', 'green', 'blue', 'yellow'];
const SAFE_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];

const BOARD_CONFIG = {
  4: { homePosition: 61, homeStretch: 52 },
  5: { homePosition: 73, homeStretch: 65 },
  6: { homePosition: 86, homeStretch: 78 },
};

const DEFAULT_TABLES = {
  teamUp: 'team_up_rooms',
  online: 'game_rooms',
};

const TURN_TIMEOUT_MS = 20_000;

const BOT_TIMING = {
  ROLL_DELAY: 800,
  ANIMATION_DELAY: 1200,
  MOVE_DELAY: 600,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function isBot(userId) {
  return userId && userId.startsWith('00000000-');
}

function isTableNonTeamUp(tableName) {
  return tableName !== DEFAULT_TABLES.teamUp;
}

function clearTurnTimeout(roomId, tableName) {
  const key = `${tableName}:${roomId}`;
  const existing = turnTimeouts.get(key);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }
  turnTimeouts.delete(key);
}

function scheduleTurnTimeout(room, tableName) {
  if (!room?.room_id) return;
  const roomId = room.room_id;

  if (room.game_state !== 'playing' || !room.turn) {
    clearTurnTimeout(roomId, tableName);
    return;
  }

  // Disconnected players are bot-controlled; do not schedule timeout misses for them.
  if ((room.disconnected_players || []).includes(room.turn)) {
    clearTurnTimeout(roomId, tableName);
    return;
  }

  const key = `${tableName}:${roomId}`;
  const existing = turnTimeouts.get(key);
  if (existing?.turn === room.turn) {
    return;
  }

  clearTurnTimeout(roomId, tableName);

  const timeoutId = setTimeout(() => {
    handleTurnTimeout(roomId, tableName, room.turn).catch((e) => {
      console.error(` [TURN TIMER] Error on timeout for ${key}:`, e);
    });
  }, TURN_TIMEOUT_MS);

  turnTimeouts.set(key, { turn: room.turn, timeoutId });
  console.log(` [TURN TIMER] Scheduled timeout for ${key} turn=${room.turn}`);
}

async function handleTurnTimeout(roomId, tableName, expectedTurn) {
  const { data: room, error } = await supabaseAdmin
    .from(tableName)
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (error || !room) return;
  if (room.game_state !== 'playing') return;
  if (!room.turn || room.turn !== expectedTurn) return;

  const userId = room.turn;
  if (isBot(userId)) return;

  // If player is disconnected, bot is responsible for playing; do not penalize.
  if ((room.disconnected_players || []).includes(userId)) return;

  const noOfPlayers = room.no_of_players || 4;
  const config = BOARD_CONFIG[noOfPlayers] || BOARD_CONFIG[4];

  const timeoutMisses = { ...(room.timeout_misses || {}) };
  const currentMisses = Number(timeoutMisses[userId] || 0);
  const nextMisses = currentMisses + 1;
  timeoutMisses[userId] = nextMisses;

  const escapedPlayers = [...(room.escaped_players || [])];
  const kickedPlayers = [...(room.kicked_players || [])];
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

  const skipPlayers = [
    ...(roomForTurn.winners || []),
    ...(roomForTurn.escaped_players || []),
    ...(roomForTurn.kicked_players || []),
  ];

  const nextTurn = getNextTurn(
    room.players,
    userId,
    skipPlayers,
    noOfPlayers,
    isTableNonTeamUp(tableName) ? DEFAULT_TABLES.online : DEFAULT_TABLES.teamUp,
  );

  if (shouldKick) {
    await supabaseAdmin
      .from(tableName)
      .update({
        timeout_misses: timeoutMisses,
        escaped_players: escapedPlayers,
        kicked_players: kickedPlayers,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    return;
  }

  const pendingSteps = room.pending_steps?.[userId] || 0;
  const diceResult = room.dice_result || 0;
  const steps = pendingSteps > 0 ? pendingSteps : diceResult;
  const playerColor = room.players?.[userId];

  // If we can't resolve playerColor (shouldn't happen), just pass turn.
  if (!playerColor) {
    await supabaseAdmin
      .from(tableName)
      .update({
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
        timeout_misses: timeoutMisses,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    return;
  }

  // If no dice rolled yet (or invalid), just pass.
  if (room.dice_state === 'waiting' || steps <= 0) {
    await supabaseAdmin
      .from(tableName)
      .update({
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
        timeout_misses: timeoutMisses,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    return;
  }

  // Dice is rolled: auto-move a random valid token, then ALWAYS pass (per requirement).
  const positions = room.positions?.[playerColor] || {};
  const validMoves = getValidMoves(positions, steps, config.homePosition);

  if (!validMoves || validMoves.length === 0) {
    await supabaseAdmin
      .from(tableName)
      .update({
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
        timeout_misses: timeoutMisses,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    return;
  }

  const chosen = validMoves[Math.floor(Math.random() * validMoves.length)];
  const newPositions = JSON.parse(JSON.stringify(room.positions || {}));
  newPositions[playerColor][chosen.tokenName] = chosen.newPos;

  // Check for kills
  if (isTableNonTeamUp(tableName)) {
    checkForKills(room, playerColor, chosen.newPos, newPositions);
  } else {
    const safePositions = SAFE_POSITIONS;
    if (chosen.newPos > 0 &&
        chosen.newPos < config.homeStretch &&
        !safePositions.includes(chosen.newPos)) {
      const botCoord = getCoordinateForPosition(playerColor, chosen.newPos, noOfPlayers);
      if (botCoord) {
        for (const [otherColor, otherTokens] of Object.entries(newPositions)) {
          if (otherColor === playerColor) continue;
          for (const [tokenName, tokenPos] of Object.entries(otherTokens)) {
            if (tokenPos > 0 && tokenPos < config.homeStretch) {
              const otherCoord = getCoordinateForPosition(otherColor, tokenPos, noOfPlayers);
              if (otherCoord && botCoord[0] === otherCoord[0] && botCoord[1] === otherCoord[1]) {
                newPositions[otherColor][tokenName] = 0;
              }
            }
          }
        }
      }
    }
  }

  let winners = [...(room.winners || [])];
  const allFinished = Object.values(newPositions[playerColor]).every(pos => pos === config.homePosition);
  if (allFinished && !winners.includes(userId)) {
    winners.push(userId);
  }

  const updatedPendingStepsAfterMove = { ...updatedPendingSteps, [userId]: 0 };

  const gameFinished = winners.length >= Object.keys(room.players || {}).length - 1;

  await supabaseAdmin
    .from(tableName)
    .update({
      positions: newPositions,
      pending_steps: updatedPendingStepsAfterMove,
      timeout_misses: timeoutMisses,
      dice_state: 'waiting',
      dice_result: null,
      turn: nextTurn,
      winners: winners,
      game_state: gameFinished ? 'finished' : 'playing',
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);
}

function getBotProfile(botId) {
  return BOT_PROFILES[botId] || { name: 'Bot', avatar: 'assets/images/avatars/avatarmale1.png' };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 300));
}

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function getTurnOrderForRoom(noOfPlayers, tableName = DEFAULT_TABLES.teamUp) {
  if (tableName === DEFAULT_TABLES.teamUp) {
    return ['red', 'green', 'blue', 'yellow'];
  }

  if (noOfPlayers === 2) return ['blue', 'green'];
  if (noOfPlayers === 3) return ['red', 'yellow', 'green'];
  if (noOfPlayers === 4) return ['red', 'blue', 'yellow', 'green'];
  if (noOfPlayers === 5) return ['red', 'green', 'orange', 'blue', 'yellow'];
  return ['red', 'orange', 'green', 'yellow', 'purple', 'blue'];
}

function getNextTurn(players, currentUserId, skipPlayers = [], noOfPlayers = 4, tableName = DEFAULT_TABLES.teamUp) {
  const currentColor = players[currentUserId];
  if (!currentColor) return null;

  const turnOrder = getTurnOrderForRoom(noOfPlayers, tableName);

  const currentIndex = turnOrder.indexOf(currentColor);
  if (currentIndex === -1) return null;

  for (let i = 1; i <= turnOrder.length; i++) {
    const nextIndex = (currentIndex + i) % turnOrder.length;
    const nextColor = turnOrder[nextIndex];

    for (const [odId, color] of Object.entries(players)) {
      if (color === nextColor && !skipPlayers.includes(odId)) {
        return odId;
      }
    }
  }
  return null;
}

function hasValidMoves(positions, diceResult, homePosition) {
  for (const pos of Object.values(positions)) {
    if (pos === 0 && diceResult === 6) return true;
    if (pos > 0 && pos < homePosition && pos + diceResult <= homePosition) return true;
  }
  return false;
}

function getValidMoves(positions, diceResult, homePosition) {
  const moves = [];
  const tokenNames = ['tokenA', 'tokenB', 'tokenC', 'tokenD'];
  
  for (const tokenName of tokenNames) {
    const pos = positions[tokenName] || 0;
    
    if (pos === 0 && diceResult === 6) {
      moves.push({ tokenName, currentPos: pos, newPos: 1, type: 'exit' });
    } else if (pos > 0 && pos < homePosition) {
      const newPos = pos + diceResult;
      if (newPos <= homePosition) {
        moves.push({ tokenName, currentPos: pos, newPos, type: newPos === homePosition ? 'finish' : 'move' });
      }
    }
  }
  return moves;
}

function getCoordinateForPosition(color, position, noOfPlayers) {
  let positionMap;
  switch (noOfPlayers) {
    case 5: positionMap = positions5Player; break;
    case 6: positionMap = positions6Player; break;
    default: positionMap = positions4Player;
  }
  return positionMap[color]?.[position] || null;
}

function decideBestMove(validMoves, color, allPositions, noOfPlayers) {
  if (validMoves.length === 0) return null;
  if (validMoves.length === 1) return validMoves[0];

  const config = BOARD_CONFIG[noOfPlayers] || BOARD_CONFIG[4];
  const safePositions = getStarPositions(noOfPlayers) || SAFE_POSITIONS;
  
  const scoredMoves = validMoves.map(move => {
    let score = 0;
    if (move.type === 'finish') score += 500;
    if (move.type === 'exit') score += 300;
    if (safePositions.includes(move.newPos)) score += 200;
    score += move.newPos;
    score += Math.random() * 30;
    return { ...move, score };
  });

  scoredMoves.sort((a, b) => b.score - a.score);
  return scoredMoves[0];
}

// ============================================
// ROOM SUBSCRIPTION MANAGEMENT
// ============================================

// Keyed by `${tableName}:${roomId}`
const activeRoomSubscriptions = new Map();
const processingRooms = new Set();
const turnTimeouts = new Map();


// ============================================
// SINGLE ENTRY POINT - HANDLE BOT TURN
// ============================================

async function handleBotTurn(room, tableName = DEFAULT_TABLES.teamUp) {
  if (!room.turn) return;
  const isDisconnectedTurn = (room.disconnected_players || []).includes(room.turn);
  if (!isBot(room.turn) && !isDisconnectedTurn) return;
  if (room.game_state !== 'playing') return;
  
  const roomKey = `${tableName}:${room.room_id}-${room.turn}-${room.dice_state}`;
  if (processingRooms.has(roomKey)) {
    console.log(` [BOT] Already processing ${roomKey}, skipping`);
    return;
  }
  
  processingRooms.add(roomKey);
  
  try {
    const diceState = room.dice_state;
    const pendingSteps = room.pending_steps?.[room.turn] || 0;
    
    console.log(` [BOT] Turn handler: state=${diceState}, pending=${pendingSteps}, turn=${room.turn}`);
    
    switch (diceState) {
      case 'waiting':
        if (pendingSteps === 0) await botRoll(room, tableName);
        break;
      case 'rolling':
        await botCompleteDice(room, tableName);
        break;
      case 'complete':
        if (pendingSteps > 0) await botMove(room, tableName);
        break;
    }
  } catch (error) {
    console.error(` [BOT] Error handling turn:`, error);
  } finally {
    processingRooms.delete(roomKey);
  }
}

// ============================================
// BOT ACTIONS
// ============================================

async function botRoll(room, tableName) {
  console.log(` [BOT] Rolling dice for ${room.turn}...`);
  await delay(BOT_TIMING.ROLL_DELAY);
  
  const diceResult = rollDice();
  console.log(` [BOT] Rolled: ${diceResult}`);
  
  const { error } = await supabaseAdmin
    .from(tableName)
    .update({
      dice_state: 'rolling',
      dice_result: diceResult,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', room.room_id)
    .eq('turn', room.turn)
    .eq('dice_state', 'waiting');
  
  if (error) console.error(` [BOT] Roll error:`, error);
}

async function botCompleteDice(room, tableName) {
  console.log(` [BOT] Completing dice for ${room.turn}...`);
  await delay(BOT_TIMING.ANIMATION_DELAY);
  
  const botId = room.turn;
  const botColor = room.players[botId];
  const positions = room.positions[botColor];
  const diceResult = room.dice_result;
  const noOfPlayers = room.no_of_players || 4;
  const config = BOARD_CONFIG[noOfPlayers] || BOARD_CONFIG[4];
  
  const skipPlayers = [
    ...(room.winners || []),
    ...(room.escaped_players || []),
    ...(room.kicked_players || []),
  ];
  
  const hasValid = hasValidMoves(positions, diceResult, config.homePosition);
  
  if (hasValid) {
    const { error } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_state: 'complete',
        pending_steps: { ...room.pending_steps, [botId]: diceResult },
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', room.room_id)
      .eq('turn', botId)
      .eq('dice_state', 'rolling');
    
    if (error) console.error(` [BOT] Complete dice error:`, error);
    else console.log(` [BOT] Dice completed, pending: ${diceResult}`);
  } else {
    const nextTurn = getNextTurn(
      room.players,
      botId,
      skipPlayers,
      noOfPlayers,
      tableName,
    );
    
    const { error } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_state: 'waiting',
        dice_result: null,
        turn: nextTurn,
        pending_steps: { ...room.pending_steps, [botId]: 0 },
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', room.room_id)
      .eq('turn', botId)
      .eq('dice_state', 'rolling');
    
    if (error) console.error(` [BOT] Pass turn error:`, error);
    else console.log(` [BOT] No moves, passed to ${nextTurn}`);
  }
}

async function botMove(room, tableName) {
  console.log(` [BOT] Moving token for ${room.turn}...`);
  await delay(BOT_TIMING.MOVE_DELAY);
  
  const botId = room.turn;
  const botColor = room.players[botId];
  const positions = room.positions[botColor];
  const pendingSteps = room.pending_steps[botId] || 0;
  const noOfPlayers = room.no_of_players || 4;
  const config = BOARD_CONFIG[noOfPlayers] || BOARD_CONFIG[4];
  
  const skipPlayers = [
    ...(room.winners || []),
    ...(room.escaped_players || []),
    ...(room.kicked_players || []),
  ];
  
  if (pendingSteps === 0) {
    console.log(` [BOT] No pending steps`);
    return;
  }
  
  const validMoves = getValidMoves(positions, pendingSteps, config.homePosition);
  const bestMove = decideBestMove(validMoves, botColor, room.positions, noOfPlayers);
  
  if (!bestMove) {
    console.log(` [BOT] No valid moves, passing turn`);
    const nextTurn = getNextTurn(
      room.players,
      botId,
      skipPlayers,
      noOfPlayers,
      tableName,
    );
    
    await supabaseAdmin
      .from(tableName)
      .update({
        dice_state: 'waiting',
        dice_result: null,
        turn: nextTurn,
        pending_steps: { ...room.pending_steps, [botId]: 0 },
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', room.room_id)
      .eq('turn', botId)
      .eq('dice_state', 'complete');
    return;
  }
  
  console.log(` [BOT] Moving ${botColor}:${bestMove.tokenName} from ${bestMove.currentPos} to ${bestMove.newPos}`);
  
  const newPositions = JSON.parse(JSON.stringify(room.positions));
  newPositions[botColor][bestMove.tokenName] = bestMove.newPos;

  // Check for kills
  let madeKill = false;
  if (tableName === DEFAULT_TABLES.online) {
    const killResult = checkForKills(room, botColor, bestMove.newPos, newPositions);
    madeKill = killResult.bonusRoll === true;
  } else {
    // Legacy team_up_rooms kill logic
    const safePositions = SAFE_POSITIONS;
    if (bestMove.newPos > 0 &&
        bestMove.newPos < config.homeStretch &&
        !safePositions.includes(bestMove.newPos)) {
      const botCoord = getCoordinateForPosition(botColor, bestMove.newPos, noOfPlayers);
      if (botCoord) {
        const matches = [];
        for (const [otherColor, otherTokens] of Object.entries(newPositions)) {
          if (otherColor === botColor) continue;
          for (const [tokenName, tokenPos] of Object.entries(otherTokens)) {
            if (tokenPos > 0 && tokenPos < config.homeStretch) {
              const otherCoord = getCoordinateForPosition(otherColor, tokenPos, noOfPlayers);
              if (otherCoord && botCoord[0] === otherCoord[0] && botCoord[1] === otherCoord[1]) {
                matches.push({ otherColor, tokenName });
              }
            }
          }
        }

        if (matches.length === 1) {
          const victim = matches[0];
          newPositions[victim.otherColor][victim.tokenName] = 0;
          madeKill = true;
          console.log(` [BOT] Killed ${victim.otherColor}:${victim.tokenName}!`);
        }
      }
    }
  }
  
  let winners = [...(room.winners || [])];
  const allFinished = Object.values(newPositions[botColor]).every(pos => pos === config.homePosition);
  if (allFinished && !winners.includes(botId)) {
    winners.push(botId);
    console.log(` [BOT] ${botId} finished! Position: ${winners.length}`);
  }
  
  const updatedSkipPlayers = [...skipPlayers, ...winners.filter(w => !skipPlayers.includes(w))];
  const gotSix = pendingSteps === 6;
  const reachedFinish = bestMove.newPos === config.homePosition;
  const keepsTurn = (gotSix || madeKill || reachedFinish) && !allFinished;
  const nextTurn = keepsTurn
    ? botId
    : getNextTurn(room.players, botId, updatedSkipPlayers, noOfPlayers, tableName);
  const gameFinished = winners.length >= Object.keys(room.players).length - 1;
  
  console.log(` [BOT] Next turn: ${nextTurn} (six=${gotSix}, kill=${madeKill}, finish=${reachedFinish})`);
  
  const { error } = await supabaseAdmin
    .from(tableName)
    .update({
      positions: newPositions,
      pending_steps: { ...room.pending_steps, [botId]: 0 },
      dice_state: 'waiting',
      dice_result: null,
      turn: nextTurn,
      winners: winners,
      game_state: gameFinished ? 'finished' : 'playing',
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', room.room_id)
    .eq('turn', botId)
    .eq('dice_state', 'complete');
  
  if (error) console.error(` [BOT] Move error:`, error);
  else console.log(` [BOT] Move complete`);
}


// ============================================
// ROOM SUBSCRIPTION
// ============================================

function subscribeToRoom(roomId) {
  return subscribeToRoomInTable(roomId, DEFAULT_TABLES.teamUp);
}

function subscribeToRoomInTable(roomId, tableName) {
  const key = `${tableName}:${roomId}`;
  if (activeRoomSubscriptions.has(key)) {
    console.log(` [BOT] Already subscribed to room ${key}`);
    return;
  }
  
  console.log(` [BOT] Subscribing to room ${roomId} in ${tableName}...`);
  
  const channel = supabaseAdmin
    .channel(`bot-room-${tableName}-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: tableName,
        filter: `room_id=eq.${roomId}`,
      },
      async (payload) => {
        if (payload.new) {
          scheduleTurnTimeout(payload.new, tableName);
          await handleBotTurn(payload.new, tableName);
        }
      }
    )
    .subscribe((status) => {
      console.log(` [BOT] Room ${roomId} (${tableName}) subscription: ${status}`);
    });
  
  activeRoomSubscriptions.set(key, channel);
}

async function unsubscribeFromRoom(roomId) {
  await unsubscribeFromRoomInTable(roomId, DEFAULT_TABLES.teamUp);
}

async function unsubscribeFromRoomInTable(roomId, tableName) {
  const key = `${tableName}:${roomId}`;
  const channel = activeRoomSubscriptions.get(key);
  if (channel) {
    await supabaseAdmin.removeChannel(channel);
    activeRoomSubscriptions.delete(key);
    console.log(` [BOT] Unsubscribed from room ${key}`);
  }
}

// ============================================
// BOT MANAGEMENT
// ============================================

async function addBotToRoom(roomId, botIndex = 0) {
  const botId = FIXED_BOT_IDS[botIndex % FIXED_BOT_IDS.length];
  
  const { data: room, error } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  
  if (error || !room) throw new Error('Room not found');
  if (room.players[botId]) return { botId, alreadyInRoom: true };
  
  const usedColors = Object.values(room.players);
  const availableColors = TEAM_UP_TURN_ORDER.filter(c => !usedColors.includes(c));
  if (availableColors.length === 0) throw new Error('Room is full');
  
  const botColor = availableColors[0];
  const newPlayers = { ...room.players, [botId]: botColor };
  const newTeamA = room.team_a.length < 2 ? [...room.team_a, botId] : room.team_a;
  const newTeamB = room.team_a.length >= 2 ? [...room.team_b, botId] : room.team_b;
  const newPositions = { ...room.positions, [botColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 } };
  
  await supabaseAdmin
    .from('team_up_rooms')
    .update({
      players: newPlayers,
      team_a: newTeamA,
      team_b: newTeamB,
      positions: newPositions,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);
  
  console.log(` [BOT] Added ${botId} as ${botColor} to room ${roomId}`);
  return { botId, alreadyInRoom: false, color: botColor };
}

async function fillRoomWithBots(roomId) {
  const { data: room, error } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  
  if (error || !room) throw new Error('Room not found');
  
  const currentPlayerCount = Object.keys(room.players).length;
  const botsNeeded = 4 - currentPlayerCount;
  const addedBots = [];
  
  for (let i = 0; i < botsNeeded; i++) {
    let botIndex = 0;
    while (room.players[FIXED_BOT_IDS[botIndex]] && botIndex < FIXED_BOT_IDS.length) {
      botIndex++;
    }
    if (botIndex >= FIXED_BOT_IDS.length) break;
    
    const result = await addBotToRoom(roomId, botIndex);
    if (!result.alreadyInRoom) addedBots.push(result.botId);
    
    const { data: updatedRoom } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (updatedRoom) room.players = updatedRoom.players;
  }
  
  console.log(` [BOT] Filled room ${roomId} with ${addedBots.length} bots`);
  return addedBots;
}

async function startBotPlayersForRoom(roomId) {
  console.log(` [BOT] Starting bot players for room ${roomId}`);
  subscribeToRoomInTable(roomId, DEFAULT_TABLES.teamUp);
  
  const { data: room } = await supabaseAdmin
    .from(DEFAULT_TABLES.teamUp)
    .select('*')
    .eq('room_id', roomId)
    .single();
  
  if (room && room.game_state === 'playing') {
    await handleBotTurn(room, DEFAULT_TABLES.teamUp);
  }
  
  const botsInRoom = Object.keys(room?.players || {}).filter(isBot);
  return botsInRoom;
}

async function stopBotPlayersForRoom(roomId) {
  console.log(` [BOT] Stopping bot players for room ${roomId}`);
  await unsubscribeFromRoomInTable(roomId, DEFAULT_TABLES.teamUp);
}

function getActiveBotCount(roomId) {
  return activeRoomSubscriptions.has(`${DEFAULT_TABLES.teamUp}:${roomId}`) ? 1 : 0;
}

// ============================================
// ONLINE (GAME ROOMS) BOT MANAGEMENT
// ============================================

async function startBotPlayersForGameRoom(roomId) {
  console.log(` [BOT] Starting bot players for game room ${roomId}`);
  subscribeToRoomInTable(roomId, DEFAULT_TABLES.online);

  const { data: room } = await supabaseAdmin
    .from(DEFAULT_TABLES.online)
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (room && room.game_state === 'playing') {
    await handleBotTurn(room, DEFAULT_TABLES.online);
  }

  const botsInRoom = Object.keys(room?.players || {}).filter(isBot);
  return botsInRoom;
}

async function stopBotPlayersForGameRoom(roomId) {
  console.log(` [BOT] Stopping bot players for game room ${roomId}`);
  await unsubscribeFromRoomInTable(roomId, DEFAULT_TABLES.online);
}

function getActiveBotCountForGameRoom(roomId) {
  return activeRoomSubscriptions.has(`${DEFAULT_TABLES.online}:${roomId}`) ? 1 : 0;
}

// ============================================
// GLOBAL ROOM WATCHER
// ============================================

let globalRoomWatcher = null;

let globalGameRoomWatcher = null;
let globalFriendRoomWatcher = null;

function startGlobalRoomWatcher() {
  if (globalRoomWatcher) {
    console.log(' [BOT WATCHER] Already running');
    return;
  }
  
  console.log(' [BOT WATCHER] Starting global room watcher...');
  
  globalRoomWatcher = supabaseAdmin
    .channel('global-bot-watcher')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'team_up_rooms' },
      async (payload) => {
        const room = payload.new;
        const oldRoom = payload.old;

        scheduleTurnTimeout(room, DEFAULT_TABLES.teamUp);
        
        if (room.game_state === 'playing' && oldRoom?.game_state !== 'playing') {
          console.log(` [BOT WATCHER] Game started: ${room.room_id}`);
          await startBotPlayersForRoom(room.room_id);
        }
        
        if (room.game_state === 'finished' && oldRoom?.game_state !== 'finished') {
          console.log(` [BOT WATCHER] Game finished: ${room.room_id}`);
          await stopBotPlayersForRoom(room.room_id);
          clearTurnTimeout(room.room_id, DEFAULT_TABLES.teamUp);
        }
      }
    )
    .subscribe((status) => {
      console.log(` [BOT WATCHER] Status: ${status}`);
    });
}

function startGlobalGameRoomWatcher() {
  if (globalGameRoomWatcher) {
    console.log(' [BOT GAME WATCHER] Already running');
    return;
  }

  console.log(' [BOT GAME WATCHER] Starting global game_rooms watcher...');

  globalGameRoomWatcher = supabaseAdmin
    .channel('global-game-bot-watcher')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: DEFAULT_TABLES.online },
      async (payload) => {
        const room = payload.new;
        const oldRoom = payload.old;

        scheduleTurnTimeout(room, DEFAULT_TABLES.online);
        
        if (room.game_state === 'playing' && oldRoom?.game_state !== 'playing') {
          console.log(` [BOT GAME WATCHER] Game started: ${room.room_id}`);
          await startBotPlayersForGameRoom(room.room_id);
        }

        if (room.game_state === 'finished' && oldRoom?.game_state !== 'finished') {
          console.log(` [BOT GAME WATCHER] Game finished: ${room.room_id}`);
          await stopBotPlayersForGameRoom(room.room_id);
          clearTurnTimeout(room.room_id, DEFAULT_TABLES.online);
        }
      }
    )
    .subscribe((status) => {
      console.log(` [BOT GAME WATCHER] Status: ${status}`);
    });
}

function startGlobalFriendRoomWatcher() {
  if (globalFriendRoomWatcher) {
    console.log(' [FRIEND TIMER] Already running');
    return;
  }

  console.log(' [FRIEND TIMER] Starting global friend_rooms watcher...');

  globalFriendRoomWatcher = supabaseAdmin
    .channel('global-friend-turn-timer')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'friend_rooms' },
      async (payload) => {
        const room = payload.new;
        const oldRoom = payload.old;

        scheduleTurnTimeout(room, 'friend_rooms');
        await handleBotTurn(room, 'friend_rooms');
        if (room.game_state === 'finished' && oldRoom?.game_state !== 'finished') {
          clearTurnTimeout(room.room_id, 'friend_rooms');
        }
      },
    )
    .subscribe((status) => {
      console.log(` [FRIEND TIMER] Status: ${status}`);
    });
}

async function stopGlobalRoomWatcher() {
  if (globalRoomWatcher) {
    await supabaseAdmin.removeChannel(globalRoomWatcher);
    globalRoomWatcher = null;
    console.log('🛑 [BOT WATCHER] Stopped');
  }

  if (globalGameRoomWatcher) {
    await supabaseAdmin.removeChannel(globalGameRoomWatcher);
    globalGameRoomWatcher = null;
    console.log('🛑 [BOT GAME WATCHER] Stopped');
  }
}

startGlobalRoomWatcher();
startGlobalGameRoomWatcher();
startGlobalFriendRoomWatcher();

// ============================================
// EXPORTS
// ============================================

export {
  FIXED_BOT_IDS,
  BOT_PROFILES,
  isBot,
  getBotProfile,
  handleBotTurn,
  addBotToRoom,
  fillRoomWithBots,
  startBotPlayersForRoom,
  stopBotPlayersForRoom,
  getActiveBotCount,
  subscribeToRoom,
  unsubscribeFromRoom,
  startGlobalRoomWatcher,
  stopGlobalRoomWatcher,
  startBotPlayersForGameRoom,
  stopBotPlayersForGameRoom,
  getActiveBotCountForGameRoom,
};

export default {
  FIXED_BOT_IDS,
  BOT_PROFILES,
  isBot,
  getBotProfile,
  handleBotTurn,
  addBotToRoom,
  fillRoomWithBots,
  startBotPlayersForRoom,
  stopBotPlayersForRoom,
  getActiveBotCount,
};
