import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import {
  getBoardConfig,
  checkForKills,
  hasValidMoves,
  checkAllTokensHome,
  getNextTurn,
  generateBotId,
  assignColor
} from '../utils/gameHelpers.js';

const router = express.Router();

// Helper function to find room in game_rooms, friend_rooms, or tournament_rooms
async function findGameRoom(roomId) {
  const startTime = Date.now();
  console.log(`🔍 [FIND ROOM] Starting search for room: ${roomId} at ${new Date().toISOString()}`);
  
  // First try game_rooms
  console.log(`🔍 [FIND ROOM] Step 1: Querying game_rooms table...`);
  const gameRoomsStart = Date.now();
  let { data: gameRoom, error } = await supabaseAdmin
    .from('game_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  const gameRoomsEnd = Date.now();
  console.log(`🔍 [FIND ROOM] Step 1 complete: game_rooms query took ${gameRoomsEnd - gameRoomsStart}ms`);

  if (gameRoom) {
    const totalTime = Date.now() - startTime;
    console.log(`✅ [FIND ROOM] Found in game_rooms! Total time: ${totalTime}ms`);
    return { gameRoom, tableName: 'game_rooms' };
  }

  // If not found, try friend_rooms
  console.log(`🔍 [FIND ROOM] Step 2: Not found in game_rooms, querying friend_rooms table...`);
  const friendRoomsStart = Date.now();
  const { data: friendRoom, error: friendError } = await supabaseAdmin
    .from('friend_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  const friendRoomsEnd = Date.now();
  console.log(`🔍 [FIND ROOM] Step 2 complete: friend_rooms query took ${friendRoomsEnd - friendRoomsStart}ms`);

  if (friendRoom) {
    const totalTime = Date.now() - startTime;
    console.log(`✅ [FIND ROOM] Found in friend_rooms! Total time: ${totalTime}ms`);
    return { gameRoom: friendRoom, tableName: 'friend_rooms' };
  }

  // If not found, try tournament_rooms
  console.log(`🔍 [FIND ROOM] Step 3: Not found in friend_rooms, querying tournament_rooms table...`);
  const tournamentRoomsStart = Date.now();
  const { data: tournamentRoom, error: tournamentError } = await supabaseAdmin
    .from('tournament_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();
  const tournamentRoomsEnd = Date.now();
  console.log(`🔍 [FIND ROOM] Step 3 complete: tournament_rooms query took ${tournamentRoomsEnd - tournamentRoomsStart}ms`);

  if (tournamentRoom) {
    const totalTime = Date.now() - startTime;
    console.log(`✅ [FIND ROOM] Found in tournament_rooms! Total time: ${totalTime}ms`);
    return { gameRoom: tournamentRoom, tableName: 'tournament_rooms' };
  }

  const totalTime = Date.now() - startTime;
  console.log(`❌ [FIND ROOM] Room not found in any table! Total search time: ${totalTime}ms`);
  return { gameRoom: null, tableName: null };
}

// Bot Roll Dice (No auth required - bot sends its own ID)
router.post('/:roomId/bot-roll-dice', async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🎲 [BOT ROLL ${requestId}] ===== REQUEST START ===== at ${new Date().toISOString()}`);
  console.log(`🎲 [BOT ROLL ${requestId}] Room ID: ${req.params.roomId}`);
  console.log(`🎲 [BOT ROLL ${requestId}] Bot User ID: ${req.body.botUserId}`);
  
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    // Step 1: Validate input
    console.log(`🎲 [BOT ROLL ${requestId}] Step 1: Validating input...`);
    const step1Start = Date.now();
    
    if (!botUserId) {
      console.log(`❌ [BOT ROLL ${requestId}] Step 1 FAILED: botUserId is required`);
      return res.status(400).json({ error: 'botUserId is required' });
    }
    
    const step1End = Date.now();
    console.log(`✅ [BOT ROLL ${requestId}] Step 1 complete: Input validation took ${step1End - step1Start}ms`);

    // Step 2: Find game room
    console.log(`🎲 [BOT ROLL ${requestId}] Step 2: Finding game room...`);
    const step2Start = Date.now();
    
    const { gameRoom, tableName } = await findGameRoom(roomId);
    
    const step2End = Date.now();
    console.log(`🎲 [BOT ROLL ${requestId}] Step 2 complete: Find room took ${step2End - step2Start}ms`);

    if (!gameRoom) {
      console.log(`❌ [BOT ROLL ${requestId}] Step 2 FAILED: Game room not found`);
      return res.status(404).json({ error: 'Game room not found' });
    }
    
    console.log(`🎲 [BOT ROLL ${requestId}] Found room in table: ${tableName}`);

    // Step 3: Validate game state
    console.log(`🎲 [BOT ROLL ${requestId}] Step 3: Validating game state...`);
    const step3Start = Date.now();

    if (gameRoom.turn !== botUserId) {
      console.log(`❌ [BOT ROLL ${requestId}] Step 3 FAILED: Not bot turn. Current turn: ${gameRoom.turn}, Bot: ${botUserId}`);
      return res.status(403).json({ error: 'Not bot turn' });
    }

    if (gameRoom.game_state !== 'playing') {
      console.log(`❌ [BOT ROLL ${requestId}] Step 3 FAILED: Game not playing. State: ${gameRoom.game_state}`);
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    if (pendingSteps[botUserId] && pendingSteps[botUserId] > 0) {
      console.log(`❌ [BOT ROLL ${requestId}] Step 3 FAILED: Bot has pending steps: ${pendingSteps[botUserId]}`);
      return res.status(400).json({ error: 'Bot must move a token first' });
    }

    const step3End = Date.now();
    console.log(`✅ [BOT ROLL ${requestId}] Step 3 complete: Game state validation took ${step3End - step3Start}ms`);

    // Step 4: Generate dice result
    console.log(`🎲 [BOT ROLL ${requestId}] Step 4: Generating dice result...`);
    const step4Start = Date.now();
    
    const diceResult = Math.floor(Math.random() * 6) + 1;
    
    const step4End = Date.now();
    console.log(`✅ [BOT ROLL ${requestId}] Step 4 complete: Generated dice ${diceResult}, took ${step4End - step4Start}ms`);

    // Step 5: Update database
    console.log(`🎲 [BOT ROLL ${requestId}] Step 5: Updating database...`);
    console.log(`🎲 [BOT ROLL ${requestId}] Updating table: ${tableName} with dice_result: ${diceResult}`);
    const step5Start = Date.now();

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
      })
      .eq('room_id', roomId)
      .select()
      .single();

    const step5End = Date.now();
    console.log(`🎲 [BOT ROLL ${requestId}] Step 5 complete: Database update took ${step5End - step5Start}ms`);

    if (updateError) {
      console.log(`❌ [BOT ROLL ${requestId}] Step 5 FAILED: Database update error:`, updateError);
      throw updateError;
    }

    console.log(`✅ [BOT ROLL ${requestId}] Database updated successfully`);

    // Step 6: Send response
    console.log(`🎲 [BOT ROLL ${requestId}] Step 6: Sending response...`);
    const step6Start = Date.now();

    const response = { success: true, diceResult, gameRoom: updatedRoom };
    res.json(response);

    const step6End = Date.now();
    const totalTime = Date.now() - requestStartTime;
    
    console.log(`✅ [BOT ROLL ${requestId}] Step 6 complete: Response sent, took ${step6End - step6Start}ms`);
    console.log(`🎲 [BOT ROLL ${requestId}] ===== REQUEST COMPLETE ===== Total time: ${totalTime}ms`);
    console.log(`🎲 [BOT ROLL ${requestId}] Breakdown:`);
    console.log(`   - Input validation: ${step1End - step1Start}ms`);
    console.log(`   - Find room: ${step2End - step2Start}ms`);
    console.log(`   - Game state validation: ${step3End - step3Start}ms`);
    console.log(`   - Generate dice: ${step4End - step4Start}ms`);
    console.log(`   - Database update: ${step5End - step5Start}ms`);
    console.log(`   - Send response: ${step6End - step6Start}ms`);
    
  } catch (error) {
    const totalTime = Date.now() - requestStartTime;
    console.error(`❌ [BOT ROLL ${requestId}] ERROR after ${totalTime}ms:`, error);
    console.error(`❌ [BOT ROLL ${requestId}] Error stack:`, error.stack);
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

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    const diceResult = gameRoom.dice_result || 0;
    const playerColor = gameRoom.players[botUserId];
    const playerPositions = gameRoom.positions[playerColor] || {};
    const noOfPlayers = gameRoom.no_of_players || 4;

    const validMove = hasValidMoves(playerPositions, diceResult, noOfPlayers);

    if (!validMove) {
      const nextTurn = getNextTurn(Object.keys(gameRoom.players), botUserId);

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from(tableName)
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ success: true, noValidMoves: true, gameRoom: updatedRoom });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    pendingSteps[botUserId] = diceResult;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({ dice_state: 'complete', pending_steps: pendingSteps })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error completing dice for bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bot Move Token
router.post('/:roomId/bot-move-token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId, tokenName, color } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    const stepsToMove = pendingSteps[botUserId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    if (gameRoom.players[botUserId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to this bot' });
    }

    const currentPosition = gameRoom.positions[color]?.[tokenName];
    if (currentPosition === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    if (currentPosition === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }

    const noOfPlayers = gameRoom.no_of_players || 4;
    const { finalPosition, homePosition } = getBoardConfig(noOfPlayers);

    let newPosition = currentPosition === 0 ? 1 : currentPosition + stepsToMove;

    if (newPosition > homePosition) {
      return res.status(400).json({ error: 'Need exact dice count to enter home' });
    }

    let updatedPositions = {
      ...gameRoom.positions,
      [color]: { ...gameRoom.positions[color], [tokenName]: newPosition }
    };

    const killResult = checkForKills(gameRoom, color, newPosition, updatedPositions);
    updatedPositions = killResult.updatedPositions;
    const bonusRoll = killResult.bonusRoll;

    const allTokensHome = checkAllTokensHome(updatedPositions[color], noOfPlayers);
    let updatedWinners = [...(gameRoom.winners || [])];
    
    if (allTokensHome && !updatedWinners.includes(botUserId)) {
      updatedWinners.push(botUserId);
    }

    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[botUserId];

    // Check if token reached finish position (bonus turn)
    const tokenReachedFinish = newPosition === homePosition;
    if (tokenReachedFinish) {
      console.log(`🏠 [BOT] Token reached finish! Bot gets bonus turn.`);
    }

    let nextTurn = botUserId;
    // Bot keeps turn if: rolled 6, killed opponent, OR token reached finish
    if (stepsToMove !== 6 && !bonusRoll && !tokenReachedFinish) {
      nextTurn = getNextTurn(Object.keys(gameRoom.players), botUserId);
    }

    // Turn management - no consecutive sixes constraint

    const gameFinished = updatedWinners.length >= Object.keys(gameRoom.players).length - 1;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_result: null,
        dice_state: 'waiting',
        winners: updatedWinners,
        game_state: gameFinished ? 'finished' : 'playing',
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom, bonusRoll, killed: bonusRoll });
  } catch (error) {
    console.error('Error moving token for bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add bots to game room
router.post('/:roomId/add-bots', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { numberOfBots } = req.body;

    if (!numberOfBots || numberOfBots < 1) {
      return res.status(400).json({ error: 'Invalid number of bots' });
    }

    const { data: room, error: roomError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (roomError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const currentPlayers = room.players || {};
    const currentPlayerCount = Object.keys(currentPlayers).length;
    const maxPlayers = room.no_of_players;
    const emptySlots = maxPlayers - currentPlayerCount;

    if (emptySlots <= 0) {
      return res.status(400).json({ error: 'Room is already full' });
    }

    const botsToAdd = Math.min(numberOfBots, emptySlots);
    // Get free colors using the anti-clockwise turn order from assignColor
    const freeColors = [];
    let tempPlayers = { ...currentPlayers };
    for (let i = 0; i < botsToAdd; i++) {
      const nextColor = assignColor(tempPlayers, maxPlayers);
      if (nextColor) {
        freeColors.push(nextColor);
        tempPlayers[`temp_${i}`] = nextColor; // Temporarily mark as used
      }
    }

    // Use fixed bot IDs instead of generating random ones
    const fixedBotIds = [
      '00000000-0000-0000-0000-000000000001', // Arjun
      '00000000-0000-0000-0000-000000000002', // Priya
      '00000000-0000-0000-0000-000000000003', // Rahul
      '00000000-0000-0000-0000-000000000004', // Ananya
      '00000000-0000-0000-0000-000000000005', // Vikram
      '00000000-0000-0000-0000-000000000006', // Kavya
      '00000000-0000-0000-0000-000000000007', // Rohan
      '00000000-0000-0000-0000-000000000008', // Shreya
      '00000000-0000-0000-0000-000000000009', // Aditya
      '00000000-0000-0000-0000-000000000010', // Meera
    ];

    const updatedPlayers = { ...currentPlayers };

    for (let i = 0; i < botsToAdd; i++) {
      if (freeColors.length === 0) break;
      
      // Use fixed bot ID instead of generating random UUID
      const botId = fixedBotIds[i % fixedBotIds.length];
      const botColor = freeColors.shift();
      
      updatedPlayers[botId] = botColor;
    }

    // No need to create bot user entries - they already exist as fixed bots

    const currentPositions = room.positions || {};
    const updatedPositions = { ...currentPositions };
    
    for (const [botId, botColor] of Object.entries(updatedPlayers)) {
      if (!currentPlayers[botId] && !updatedPositions[botColor]) {
        updatedPositions[botColor] = {
          tokenA: 0,
          tokenB: 0,
          tokenC: 0,
          tokenD: 0
        };
      }
    }

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ players: updatedPlayers, positions: updatedPositions })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom, botsAdded: botsToAdd });
  } catch (error) {
    console.error('Error adding bots:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
