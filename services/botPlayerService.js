/**
 * Bot Player Service - Complete Backend Bot System
 * 
 * This service creates bot "players" that:
 * 1. Join rooms just like real players
 * 2. Subscribe to room updates via realtime
 * 3. React to their turns automatically
 * 4. Play the game autonomously
 * 
 * Each bot is like a virtual player with its own subscription
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

const BOT_PROFILES = {
  '00000000-0000-0000-0000-000000000001': { name: 'Arjun', avatar: 'assets/images/avatars/avatarmale4.png' },
  '00000000-0000-0000-0000-000000000002': { name: 'Priya', avatar: 'assets/images/avatars/femaleavatar4.png' },
  '00000000-0000-0000-0000-000000000003': { name: 'Rahul', avatar: 'assets/images/avatars/avatarmale2.png' },
  '00000000-0000-0000-0000-000000000004': { name: 'Sneha', avatar: 'assets/images/avatars/femaleavatar2.png' },
  '00000000-0000-0000-0000-000000000005': { name: 'Vikram', avatar: 'assets/images/avatars/avatarmale3.png' },
  '00000000-0000-0000-0000-000000000006': { name: 'Ananya', avatar: 'assets/images/avatars/femaleavatar3.png' },
};

const TURN_ORDER = ['red', 'green', 'blue', 'yellow'];
const SAFE_POSITIONS = [5, 12, 19, 26, 33, 40]; // Safe spots on the board

// Board configuration based on number of players
const BOARD_CONFIG = {
  4: { homePosition: 61, homeStretch: 52, finalPosition: 57 },
  5: { homePosition: 73, homeStretch: 65, finalPosition: 69 },
  6: { homePosition: 86, homeStretch: 78, finalPosition: 83 },
};

// Bot timing configuration (in milliseconds)
const BOT_TIMING = {
  ROLL_DELAY_MIN: 1000,
  ROLL_DELAY_MAX: 2000,
  ANIMATION_DELAY: 1800,
  MOVE_DELAY_MIN: 800,
  MOVE_DELAY_MAX: 1500,
};

// ============================================
// LUDO BOT AI - Ported from Dart
// ============================================

class LudoBotAI {
  constructor() {
    this.randomnessFactor = 0.08; // 8% chance of random move
  }

  /**
   * Get board configuration based on number of players
   */
  getBoardConfig(noOfPlayers) {
    return BOARD_CONFIG[noOfPlayers] || BOARD_CONFIG[4];
  }

  /**
   * Main decision function with optional randomness
   * Returns the best token index to move (0-3) or -1 if no valid move
   */
  decideBestMoveWithRandomness({
    tokenPositions,
    diceValue,
    playerColor,
    allPlayerPositions,
    safeSpots = SAFE_POSITIONS,
    noOfPlayers = 4,
  }) {
    const config = this.getBoardConfig(noOfPlayers);
    const homePosition = config.homePosition;

    // Small chance to pick a random valid move (makes bot less predictable)
    if (Math.random() < this.randomnessFactor) {
      const validMoves = this._getValidMoves(tokenPositions, diceValue, homePosition);
      if (validMoves.length > 0) {
        const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
        console.log(`🎲 [Bot:${playerColor}] RANDOM pick token ${randomMove}`);
        return randomMove;
      }
    }

    return this.decideBestMove({
      tokenPositions,
      diceValue,
      playerColor,
      allPlayerPositions,
      safeSpots,
      noOfPlayers,
    });
  }

  /**
   * Pure decision function (deterministic)
   * Returns the best token index to move (0-3) or -1 if no valid move
   */
  decideBestMove({
    tokenPositions,
    diceValue,
    playerColor,
    allPlayerPositions,
    safeSpots = SAFE_POSITIONS,
    noOfPlayers = 4,
  }) {
    const config = this.getBoardConfig(noOfPlayers);
    const homePosition = config.homePosition;
    const homeStretch = config.homeStretch;

    console.log(`🤖 Bot decide: color=${playerColor} dice=${diceValue} tokens=${JSON.stringify(tokenPositions)} noOfPlayers=${noOfPlayers}`);

    const validMoves = this._getValidMoves(tokenPositions, diceValue, homePosition);
    if (validMoves.length === 0) {
      console.log(`🤖 [Bot:${playerColor}] no valid moves`);
      return -1;
    }

    console.log(`🤖 Valid moves: ${JSON.stringify(validMoves)}`);

    // PRIORITY 1: Can we kill an opponent?
    const killMove = this._findKillMove(tokenPositions, diceValue, allPlayerPositions, playerColor, validMoves, homeStretch);
    if (killMove !== -1) {
      console.log(`✅ [Bot:${playerColor}] PRIORITY 1: Kill move - Token ${killMove}`);
      return killMove;
    }

    // PRIORITY 2: Can we enter home or home stretch?
    const homeMove = this._findHomeMove(tokenPositions, diceValue, validMoves, homePosition, homeStretch);
    if (homeMove !== -1) {
      console.log(`✅ [Bot:${playerColor}] PRIORITY 2: Home move - Token ${homeMove}`);
      return homeMove;
    }

    // PRIORITY 3: Move tokens out of danger
    const escapeMove = this._findEscapeMove(tokenPositions, diceValue, allPlayerPositions, playerColor, safeSpots, validMoves, homeStretch);
    if (escapeMove !== -1) {
      console.log(`✅ [Bot:${playerColor}] PRIORITY 3: Escape move - Token ${escapeMove}`);
      return escapeMove;
    }

    // PRIORITY 4: Move token out of base (if dice = 6)
    if (diceValue === 6) {
      const baseMove = this._findBaseExitMove(tokenPositions, validMoves);
      if (baseMove !== -1) {
        console.log(`✅ [Bot:${playerColor}] PRIORITY 4: Base exit - Token ${baseMove}`);
        return baseMove;
      }
    }

    // PRIORITY 5: Move to safe spot if possible
    const safeMove = this._findSafeSpotMove(tokenPositions, diceValue, safeSpots, validMoves);
    if (safeMove !== -1) {
      console.log(`✅ [Bot:${playerColor}] PRIORITY 5: Safe spot - Token ${safeMove}`);
      return safeMove;
    }

    // PRIORITY 6: Block opponent's path
    const blockMove = this._findBlockMove(tokenPositions, diceValue, allPlayerPositions, playerColor, validMoves, homeStretch);
    if (blockMove !== -1) {
      console.log(`✅ [Bot:${playerColor}] PRIORITY 6: Block move - Token ${blockMove}`);
      return blockMove;
    }

    // PRIORITY 7: Move the token that progresses the most
    const progressMove = this._findMaxProgressMove(tokenPositions, diceValue, validMoves);
    console.log(`✅ [Bot:${playerColor}] PRIORITY 7: Max progress - Token ${progressMove}`);
    return progressMove;
  }

  /**
   * Get all valid token indices that can move
   */
  _getValidMoves(positions, diceValue, homePosition) {
    const validMoves = [];
    for (let i = 0; i < positions.length; i++) {
      if (this._canMove(positions[i], diceValue, homePosition)) {
        validMoves.push(i);
      }
    }
    return validMoves;
  }

  /**
   * Check if a token can move
   */
  _canMove(position, diceValue, homePosition) {
    // Token in base (-1 or 0) can only move with 6
    if (position === -1 || position === 0) return diceValue === 6;

    // Token already at home position cannot move
    if (position >= homePosition) return false;

    // Token can move if it won't exceed home position
    if (position + diceValue > homePosition) return false;

    return true;
  }

  /**
   * PRIORITY 1: Find move that kills an opponent
   */
  _findKillMove(positions, diceValue, allPositions, playerColor, validMoves, homeStretch) {
    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0) continue; // Skip base tokens

      const newPos = currentPos + diceValue;

      // Check if any opponent is at the new position
      for (const [color, opponentPositions] of Object.entries(allPositions)) {
        if (color === playerColor) continue; // Skip own tokens

        for (const opponentPos of opponentPositions) {
          if (opponentPos === newPos && opponentPos < homeStretch && !SAFE_POSITIONS.includes(opponentPos)) {
            // Found an opponent to kill!
            return tokenIndex;
          }
        }
      }
    }
    return -1;
  }

  /**
   * PRIORITY 2: Find move that enters home or home stretch
   */
  _findHomeMove(positions, diceValue, validMoves, homePosition, homeStretch) {
    // Prefer exact finish (home position)
    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0) continue;

      const newPos = currentPos + diceValue;
      if (newPos === homePosition) {
        return tokenIndex;
      }
    }

    // Then prefer entering home stretch
    let bestMove = -1;
    let bestVal = -1;

    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0) continue;

      const newPos = currentPos + diceValue;
      if (newPos >= homeStretch && newPos < homePosition) {
        if (newPos > bestVal) {
          bestVal = newPos;
          bestMove = tokenIndex;
        }
      }
    }

    return bestMove;
  }

  /**
   * PRIORITY 3: Find move that escapes danger
   */
  _findEscapeMove(positions, diceValue, allPositions, playerColor, safeSpots, validMoves, homeStretch) {
    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0 || currentPos >= homeStretch) continue;

      // Check if current position is in danger
      if (this._isInDanger(currentPos, allPositions, playerColor, safeSpots, homeStretch)) {
        const newPos = currentPos + diceValue;

        // Move to safety if possible
        if (!this._isInDanger(newPos, allPositions, playerColor, safeSpots, homeStretch)) {
          return tokenIndex;
        }
      }
    }
    return -1;
  }

  /**
   * Check if a position is in danger from opponents
   */
  _isInDanger(position, allPositions, playerColor, safeSpots, homeStretch) {
    // Safe spots are never in danger
    if (safeSpots.includes(position)) return false;

    // Home stretch is safe
    if (position >= homeStretch) return false;

    // Check if any opponent can reach this position
    for (const [color, opponentPositions] of Object.entries(allPositions)) {
      if (color === playerColor) continue;

      for (const opponentPos of opponentPositions) {
        if (opponentPos === -1 || opponentPos === 0 || opponentPos >= homeStretch) continue;

        // Check if opponent can reach our position with dice 1-6
        for (let dice = 1; dice <= 6; dice++) {
          if (opponentPos + dice === position) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * PRIORITY 4: Find move that exits base
   */
  _findBaseExitMove(positions, validMoves) {
    for (const tokenIndex of validMoves) {
      if (positions[tokenIndex] === -1 || positions[tokenIndex] === 0) {
        return tokenIndex;
      }
    }
    return -1;
  }

  /**
   * PRIORITY 5: Find move to safe spot
   */
  _findSafeSpotMove(positions, diceValue, safeSpots, validMoves) {
    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0) continue;

      const newPos = currentPos + diceValue;

      // Check if new position is a safe spot
      if (safeSpots.includes(newPos)) {
        return tokenIndex;
      }
    }
    return -1;
  }

  /**
   * PRIORITY 6: Find move that blocks opponent
   */
  _findBlockMove(positions, diceValue, allPositions, playerColor, validMoves, homeStretch) {
    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];
      if (currentPos === -1 || currentPos === 0 || currentPos >= homeStretch) continue;

      const newPos = currentPos + diceValue;

      // Check if we can block an opponent's likely path
      for (const [color, opponentPositions] of Object.entries(allPositions)) {
        if (color === playerColor) continue;

        for (const opponentPos of opponentPositions) {
          if (opponentPos === -1 || opponentPos === 0 || opponentPos >= homeStretch) continue;

          // If opponent is close behind, block their path
          if (opponentPos < newPos && newPos - opponentPos <= 6) {
            return tokenIndex;
          }
        }
      }
    }
    return -1;
  }

  /**
   * PRIORITY 7: Find move with maximum progress
   */
  _findMaxProgressMove(positions, diceValue, validMoves) {
    if (validMoves.length === 0) return -1;

    let bestMove = validMoves[0];
    let maxProgress = positions[validMoves[0]];

    for (const tokenIndex of validMoves) {
      const currentPos = positions[tokenIndex];

      // Prefer tokens that are further ahead
      if (currentPos > maxProgress) {
        maxProgress = currentPos;
        bestMove = tokenIndex;
      }
      // If tied, prefer token that will be furthest after move
      else if (currentPos === maxProgress) {
        const currentBestNewPos = positions[bestMove] + diceValue;
        const newPos = currentPos + diceValue;
        if (newPos > currentBestNewPos) {
          bestMove = tokenIndex;
        }
      }
    }

    return bestMove;
  }
}

// Create singleton AI instance
const ludoBotAI = new LudoBotAI();

// Active bot players (roomId -> Map<botId, BotPlayer>)
const activeBotPlayers = new Map();

// Global room watcher for auto-starting bots
let globalRoomWatcher = null;

// ============================================
// GLOBAL ROOM WATCHER - Auto-starts bots when games begin
// ============================================

/**
 * Start the global room watcher that monitors all team_up_rooms
 * and automatically starts bot players when games begin
 */
function startGlobalRoomWatcher() {
  if (globalRoomWatcher) {
    console.log('⚠️ [BOT WATCHER] Global room watcher already running');
    return;
  }

  console.log('🌐 [BOT WATCHER] Starting global room watcher...');

  globalRoomWatcher = supabaseAdmin
    .channel('global-bot-watcher')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'team_up_rooms',
      },
      async (payload) => {
        const room = payload.new;
        const oldRoom = payload.old;

        // Check if game just started (state changed to 'playing')
        if (room.game_state === 'playing' && oldRoom?.game_state !== 'playing') {
          console.log(`🎮 [BOT WATCHER] Game started in room ${room.room_id}, auto-starting bots...`);
          try {
            await startBotPlayersForRoom(room.room_id);
          } catch (error) {
            console.error(`❌ [BOT WATCHER] Failed to auto-start bots for room ${room.room_id}:`, error);
          }
        }

        // Check if game ended (state changed to 'finished')
        if (room.game_state === 'finished' && oldRoom?.game_state !== 'finished') {
          console.log(`🏁 [BOT WATCHER] Game finished in room ${room.room_id}, stopping bots...`);
          try {
            await stopBotPlayersForRoom(room.room_id);
          } catch (error) {
            console.error(`❌ [BOT WATCHER] Failed to stop bots for room ${room.room_id}:`, error);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 [BOT WATCHER] Global subscription status: ${status}`);
    });

  console.log('✅ [BOT WATCHER] Global room watcher started');
}

/**
 * Stop the global room watcher
 */
async function stopGlobalRoomWatcher() {
  if (globalRoomWatcher) {
    await supabaseAdmin.removeChannel(globalRoomWatcher);
    globalRoomWatcher = null;
    console.log('🛑 [BOT WATCHER] Global room watcher stopped');
  }
}

// Auto-start the global watcher when this module loads
startGlobalRoomWatcher();

// ============================================
// BOT PLAYER CLASS
// ============================================

class BotPlayer {
  constructor(botId, roomId) {
    this.botId = botId;
    this.roomId = roomId;
    this.channel = null;
    this.isActive = false;
    this.lastProcessedState = null;
    this.processingTurn = false;
    
    console.log(`🤖 [BOT PLAYER] Created bot player: ${botId} for room ${roomId}`);
  }

  /**
   * Start the bot player - subscribe to room and start playing
   */
  async start() {
    if (this.isActive) {
      console.log(`⚠️ [BOT ${this.botId}] Already active`);
      return;
    }

    console.log(`🚀 [BOT ${this.botId}] Starting bot player for room ${this.roomId}`);
    this.isActive = true;

    // Subscribe to room updates
    this.channel = supabaseAdmin
      .channel(`bot-player-${this.botId}-${this.roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_up_rooms',
          filter: `room_id=eq.${this.roomId}`,
        },
        async (payload) => {
          if (payload.new) {
            await this.handleRoomUpdate(payload.new);
          }
        }
      )
      .subscribe((status) => {
        console.log(`📡 [BOT ${this.botId}] Subscription status: ${status}`);
      });

    // Check current room state immediately
    const { data: room } = await supabaseAdmin
      .from('team_up_rooms')
      .select('*')
      .eq('room_id', this.roomId)
      .single();

    if (room) {
      await this.handleRoomUpdate(room);
    }
  }

  /**
   * Stop the bot player
   */
  async stop() {
    console.log(`🛑 [BOT ${this.botId}] Stopping bot player`);
    this.isActive = false;

    if (this.channel) {
      await supabaseAdmin.removeChannel(this.channel);
      this.channel = null;
    }
  }

  /**
   * Handle room update - react to game state changes
   */
  async handleRoomUpdate(room) {
    if (!this.isActive) return;

    // Handle game finished - stop this bot
    if (room.game_state === 'finished') {
      console.log(`🏁 [BOT ${this.botId}] Game finished, stopping...`);
      await this.stop();
      return;
    }

    // Skip if game is not playing
    if (room.game_state !== 'playing') {
      return;
    }

    // Skip if it's not this bot's turn
    if (room.turn !== this.botId) {
      return;
    }

    // Skip if already processing a turn
    if (this.processingTurn) {
      console.log(`⏳ [BOT ${this.botId}] Already processing turn, skipping`);
      return;
    }

    // Create state signature to detect duplicates
    const stateSignature = `${room.dice_state}-${room.dice_result}-${JSON.stringify(room.pending_steps)}`;
    if (this.lastProcessedState === stateSignature) {
      return;
    }

    this.lastProcessedState = stateSignature;
    this.processingTurn = true;

    try {
      await this.playTurn(room);
    } catch (error) {
      console.error(`❌ [BOT ${this.botId}] Error playing turn:`, error);
      // Reset processing flag on error so bot can retry
      this.lastProcessedState = null;
    } finally {
      this.processingTurn = false;
    }
  }

  /**
   * Play the bot's turn based on current game state
   */
  async playTurn(room) {
    const diceState = room.dice_state;
    const pendingSteps = room.pending_steps?.[this.botId] || 0;
    const botColor = room.players[this.botId];

    console.log(`🎮 [BOT ${this.botId}] Playing turn:`);
    console.log(`   Color: ${botColor}`);
    console.log(`   Dice State: ${diceState}`);
    console.log(`   Pending Steps: ${pendingSteps}`);

    // State 1: Waiting for dice roll
    if (diceState === 'waiting' && pendingSteps === 0) {
      await this.rollDice(room);
      return;
    }

    // State 2: Dice rolling - wait for animation then complete
    if (diceState === 'rolling') {
      await this.completeDice(room);
      return;
    }

    // State 3: Dice complete with pending steps - move token
    if (diceState === 'complete' && pendingSteps > 0) {
      await this.moveToken(room);
      return;
    }
  }

  /**
   * Roll the dice
   */
  async rollDice(room) {
    console.log(`🎲 [BOT ${this.botId}] Rolling dice...`);

    // Random delay to seem more human-like
    const delay = BOT_TIMING.ROLL_DELAY_MIN + 
      Math.random() * (BOT_TIMING.ROLL_DELAY_MAX - BOT_TIMING.ROLL_DELAY_MIN);
    await this.sleep(delay);

    // Generate dice result
    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 [BOT ${this.botId}] Rolled: ${diceResult}`);

    // Update room
    const { error } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'rolling',
        dice_result: diceResult,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', this.roomId);

    if (error) {
      console.error(`❌ [BOT ${this.botId}] Error rolling dice:`, error);
    }
  }

  /**
   * Complete the dice roll (after animation)
   */
  async completeDice(room) {
    console.log(`🎲 [BOT ${this.botId}] Completing dice...`);

    // Wait for animation
    await this.sleep(BOT_TIMING.ANIMATION_DELAY);

    const botColor = room.players[this.botId];
    const positions = room.positions[botColor];
    const diceResult = room.dice_result;
    const noOfPlayers = room.no_of_players || 4;
    const config = ludoBotAI.getBoardConfig(noOfPlayers);

    // Check if bot has valid moves
    const hasValid = this.hasValidMoves(positions, diceResult, config.homePosition);

    if (hasValid) {
      // Set pending steps
      const pendingSteps = { ...room.pending_steps, [this.botId]: diceResult };

      const { error } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          dice_state: 'complete',
          pending_steps: pendingSteps,
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', this.roomId);

      if (error) {
        console.error(`❌ [BOT ${this.botId}] Error completing dice:`, error);
      } else {
        console.log(`✅ [BOT ${this.botId}] Dice completed with pending steps: ${diceResult}`);
      }
    } else {
      // No valid moves - pass turn
      console.log(`⏭️ [BOT ${this.botId}] No valid moves, passing turn`);
      const nextTurn = this.getNextTurn(room.players, this.botId, room.winners || []);

      const { error } = await supabaseAdmin
        .from('team_up_rooms')
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
          pending_steps: { ...room.pending_steps, [this.botId]: 0 },
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', this.roomId);

      if (error) {
        console.error(`❌ [BOT ${this.botId}] Error passing turn:`, error);
      }
    }
  }

  /**
   * Move a token
   */
  async moveToken(room) {
    console.log(`🎯 [BOT ${this.botId}] Moving token...`);

    // Random delay
    const delay = BOT_TIMING.MOVE_DELAY_MIN + 
      Math.random() * (BOT_TIMING.MOVE_DELAY_MAX - BOT_TIMING.MOVE_DELAY_MIN);
    await this.sleep(delay);

    const botColor = room.players[this.botId];
    const positions = room.positions[botColor];
    const pendingSteps = room.pending_steps[this.botId] || 0;
    const noOfPlayers = room.no_of_players || 4;
    const config = ludoBotAI.getBoardConfig(noOfPlayers);

    // Convert positions to array format for AI
    const tokenPositions = [
      positions.tokenA || 0,
      positions.tokenB || 0,
      positions.tokenC || 0,
      positions.tokenD || 0,
    ];

    // Build all player positions for AI
    const allPlayerPositions = {};
    for (const [color, posMap] of Object.entries(room.positions)) {
      allPlayerPositions[color] = [
        posMap.tokenA || 0,
        posMap.tokenB || 0,
        posMap.tokenC || 0,
        posMap.tokenD || 0,
      ];
    }

    console.log(`🤖 [BOT ${this.botId}] AI Input:`);
    console.log(`   Color: ${botColor}`);
    console.log(`   Dice: ${pendingSteps}`);
    console.log(`   Positions: ${JSON.stringify(tokenPositions)}`);
    console.log(`   NoOfPlayers: ${noOfPlayers}`);

    // Use AI to decide best move
    const chosenTokenIndex = ludoBotAI.decideBestMoveWithRandomness({
      tokenPositions,
      diceValue: pendingSteps,
      playerColor: botColor,
      allPlayerPositions,
      safeSpots: SAFE_POSITIONS,
      noOfPlayers,
    });

    console.log(`🎯 [BOT ${this.botId}] AI chose token index: ${chosenTokenIndex}`);

    if (chosenTokenIndex === -1) {
      console.log(`⚠️ [BOT ${this.botId}] No valid moves, passing turn`);
      await this.passTurn(room);
      return;
    }

    const tokenNames = ['tokenA', 'tokenB', 'tokenC', 'tokenD'];
    const tokenName = tokenNames[chosenTokenIndex];
    const currentPos = tokenPositions[chosenTokenIndex];
    
    // Calculate new position
    let newPos;
    if (currentPos === 0 || currentPos === -1) {
      newPos = 1; // Exit from home
    } else {
      newPos = currentPos + pendingSteps;
    }

    console.log(`🎯 [BOT ${this.botId}] Moving ${botColor}:${tokenName} from ${currentPos} to ${newPos}`);

    // Update positions
    const newPositions = JSON.parse(JSON.stringify(room.positions));
    newPositions[botColor][tokenName] = newPos;

    // Check for kills (only on main board, not in home stretch)
    const killedTokens = [];
    if (newPos > 0 && newPos < config.homeStretch && !SAFE_POSITIONS.includes(newPos)) {
      for (const [otherColor, otherTokens] of Object.entries(newPositions)) {
        if (otherColor === botColor) continue;

        for (const [otherTokenName, otherPos] of Object.entries(otherTokens)) {
          if (otherPos === newPos && otherPos > 0 && otherPos < config.homeStretch) {
            killedTokens.push({ color: otherColor, token: otherTokenName });
            newPositions[otherColor][otherTokenName] = 0;
            console.log(`💀 [BOT ${this.botId}] Killed ${otherColor} ${otherTokenName}!`);
          }
        }
      }
    }

    // Check if bot finished all tokens
    let winners = [...(room.winners || [])];
    const allFinished = Object.values(newPositions[botColor]).every(pos => pos === config.homePosition);
    if (allFinished && !winners.includes(this.botId)) {
      winners.push(this.botId);
      console.log(`🏆 [BOT ${this.botId}] Finished! Position: ${winners.length}`);
    }

    // Determine next turn
    let nextTurn;
    const gotSix = pendingSteps === 6;
    const madeKill = killedTokens.length > 0;
    const reachedHome = newPos === config.homePosition;

    if ((gotSix || madeKill || reachedHome) && !allFinished) {
      nextTurn = this.botId; // Bot gets another turn
      console.log(`🔄 [BOT ${this.botId}] Gets another turn (six: ${gotSix}, kill: ${madeKill}, home: ${reachedHome})`);
    } else {
      nextTurn = this.getNextTurn(room.players, this.botId, winners);
    }

    // Check if game is finished
    const gameFinished = winners.length >= 3;

    // Update room
    const { error } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        positions: newPositions,
        pending_steps: { ...room.pending_steps, [this.botId]: 0 },
        dice_state: 'waiting',
        dice_result: null,
        turn: nextTurn,
        winners: winners,
        game_state: gameFinished ? 'finished' : 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', this.roomId);

    if (error) {
      console.error(`❌ [BOT ${this.botId}] Error moving token:`, error);
    } else {
      console.log(`✅ [BOT ${this.botId}] Token moved. Next turn: ${nextTurn}`);
    }
  }

  /**
   * Pass turn to next player
   */
  async passTurn(room) {
    const nextTurn = this.getNextTurn(room.players, this.botId, room.winners || []);
    
    const { error } = await supabaseAdmin
      .from('team_up_rooms')
      .update({
        dice_state: 'waiting',
        dice_result: null,
        turn: nextTurn,
        pending_steps: { ...room.pending_steps, [this.botId]: 0 },
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', this.roomId);

    if (error) {
      console.error(`❌ [BOT ${this.botId}] Error passing turn:`, error);
    } else {
      console.log(`⏭️ [BOT ${this.botId}] Turn passed to ${nextTurn}`);
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  hasValidMoves(positions, diceResult, homePosition) {
    for (const [tokenName, pos] of Object.entries(positions)) {
      // Token at home - can only move with 6
      if ((pos === 0 || pos === -1) && diceResult === 6) return true;
      // Token on board
      if (pos > 0 && pos < homePosition) {
        const newPos = pos + diceResult;
        if (newPos <= homePosition) return true;
      }
    }
    return false;
  }

  getNextTurn(players, currentUserId, finishedPlayers = []) {
    const currentColor = players[currentUserId];
    if (!currentColor) return null;

    const currentIndex = TURN_ORDER.indexOf(currentColor);
    if (currentIndex === -1) return null;

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
}

// ============================================
// BOT MANAGEMENT FUNCTIONS
// ============================================

/**
 * Check if a user ID is a bot
 */
function isBot(userId) {
  return FIXED_BOT_IDS.includes(userId);
}

/**
 * Get bot profile
 */
function getBotProfile(botId) {
  return BOT_PROFILES[botId] || { name: 'Bot', avatar: 'assets/images/avatars/avatarmale1.png' };
}

/**
 * Add a bot to a room (like a player joining)
 */
async function addBotToRoom(roomId, botIndex = 0) {
  const botId = FIXED_BOT_IDS[botIndex % FIXED_BOT_IDS.length];
  
  console.log(`🤖 [BOT MANAGER] Adding bot ${botId} to room ${roomId}`);

  // Get current room state
  const { data: room, error: fetchError } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (fetchError || !room) {
    throw new Error('Room not found');
  }

  // Check if bot is already in room
  if (room.team_a.includes(botId) || room.team_b.includes(botId)) {
    console.log(`⚠️ [BOT MANAGER] Bot ${botId} already in room`);
    return { botId, alreadyInRoom: true };
  }

  // Add bot to appropriate team
  let updatedTeamA = [...room.team_a];
  let updatedTeamB = [...room.team_b];

  if (updatedTeamA.length <= updatedTeamB.length) {
    updatedTeamA.push(botId);
  } else {
    updatedTeamB.push(botId);
  }

  // Assign colors if room is now full
  let players = { ...room.players };
  const totalPlayers = updatedTeamA.length + updatedTeamB.length;
  
  if (totalPlayers === 4) {
    players[updatedTeamA[0]] = 'red';
    players[updatedTeamA[1]] = 'blue';
    players[updatedTeamB[0]] = 'green';
    players[updatedTeamB[1]] = 'yellow';
  }

  // Update room
  const { error: updateError } = await supabaseAdmin
    .from('team_up_rooms')
    .update({
      team_a: updatedTeamA,
      team_b: updatedTeamB,
      players: players,
      status: totalPlayers >= 4 ? 'full' : 'open',
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);

  if (updateError) {
    throw updateError;
  }

  console.log(`✅ [BOT MANAGER] Bot ${botId} added to room ${roomId}`);
  console.log(`   Team A: ${updatedTeamA.length}, Team B: ${updatedTeamB.length}`);

  return { botId, teamA: updatedTeamA, teamB: updatedTeamB, players };
}

/**
 * Fill room with bots
 */
async function fillRoomWithBots(roomId) {
  console.log(`🤖 [BOT MANAGER] Filling room ${roomId} with bots`);

  // Get current room state
  const { data: room, error: fetchError } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (fetchError || !room) {
    throw new Error('Room not found');
  }

  const currentPlayers = room.team_a.length + room.team_b.length;
  const botsNeeded = 4 - currentPlayers;

  console.log(`🤖 [BOT MANAGER] Current players: ${currentPlayers}, Bots needed: ${botsNeeded}`);

  const addedBots = [];
  let botIndex = 0;

  // Find first available bot index
  for (let i = 0; i < FIXED_BOT_IDS.length; i++) {
    if (!room.team_a.includes(FIXED_BOT_IDS[i]) && !room.team_b.includes(FIXED_BOT_IDS[i])) {
      botIndex = i;
      break;
    }
  }

  for (let i = 0; i < botsNeeded; i++) {
    try {
      const result = await addBotToRoom(roomId, botIndex + i);
      addedBots.push(result.botId);
    } catch (error) {
      console.error(`❌ [BOT MANAGER] Error adding bot:`, error);
    }
  }

  return addedBots;
}

/**
 * Start bot players for a room (after game starts)
 */
async function startBotPlayersForRoom(roomId) {
  console.log(`🚀 [BOT MANAGER] Starting bot players for room ${roomId}`);

  // Get room to find bots
  const { data: room, error } = await supabaseAdmin
    .from('team_up_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (error || !room) {
    throw new Error('Room not found');
  }

  // Find all bots in the room
  const allPlayers = [...room.team_a, ...room.team_b];
  const botsInRoom = allPlayers.filter(id => isBot(id));

  console.log(`🤖 [BOT MANAGER] Found ${botsInRoom.length} bots in room`);

  // Create bot players map for this room
  if (!activeBotPlayers.has(roomId)) {
    activeBotPlayers.set(roomId, new Map());
  }

  const roomBots = activeBotPlayers.get(roomId);

  // Start each bot player
  for (const botId of botsInRoom) {
    if (!roomBots.has(botId)) {
      const botPlayer = new BotPlayer(botId, roomId);
      roomBots.set(botId, botPlayer);
      await botPlayer.start();
    }
  }

  return botsInRoom;
}

/**
 * Stop all bot players for a room
 */
async function stopBotPlayersForRoom(roomId) {
  console.log(`🛑 [BOT MANAGER] Stopping bot players for room ${roomId}`);

  const roomBots = activeBotPlayers.get(roomId);
  if (!roomBots) return;

  for (const [botId, botPlayer] of roomBots) {
    await botPlayer.stop();
  }

  activeBotPlayers.delete(roomId);
}

/**
 * Get active bot count for a room
 */
function getActiveBotCount(roomId) {
  const roomBots = activeBotPlayers.get(roomId);
  return roomBots ? roomBots.size : 0;
}

// ============================================
// EXPORTS
// ============================================

export {
  BotPlayer,
  LudoBotAI,
  ludoBotAI,
  FIXED_BOT_IDS,
  BOT_PROFILES,
  BOARD_CONFIG,
  isBot,
  getBotProfile,
  addBotToRoom,
  fillRoomWithBots,
  startBotPlayersForRoom,
  stopBotPlayersForRoom,
  getActiveBotCount,
  startGlobalRoomWatcher,
  stopGlobalRoomWatcher,
};

export default {
  BotPlayer,
  LudoBotAI,
  ludoBotAI,
  FIXED_BOT_IDS,
  BOT_PROFILES,
  BOARD_CONFIG,
  isBot,
  getBotProfile,
  addBotToRoom,
  fillRoomWithBots,
  startBotPlayersForRoom,
  stopBotPlayersForRoom,
  getActiveBotCount,
  startGlobalRoomWatcher,
  stopGlobalRoomWatcher,
};
