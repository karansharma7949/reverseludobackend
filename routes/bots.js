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
  // First try game_rooms
  let { data: gameRoom, error } = await supabaseAdmin
    .from('game_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (gameRoom) {
    return { gameRoom, tableName: 'game_rooms' };
  }

  // If not found, try friend_rooms
  const { data: friendRoom, error: friendError } = await supabaseAdmin
    .from('friend_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (friendRoom) {
    return { gameRoom: friendRoom, tableName: 'friend_rooms' };
  }

  // If not found, try tournament_rooms
  const { data: tournamentRoom, error: tournamentError } = await supabaseAdmin
    .from('tournament_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (tournamentRoom) {
    return { gameRoom: tournamentRoom, tableName: 'tournament_rooms' };
  }

  return { gameRoom: null, tableName: null };
}

// Bot Roll Dice (No auth required - bot sends its own ID)
router.post('/:roomId/bot-roll-dice', async (req, res) => {
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

    if (gameRoom.game_state !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    if (pendingSteps[botUserId] && pendingSteps[botUserId] > 0) {
      return res.status(400).json({ error: 'Bot must move a token first' });
    }

    const diceResult = Math.floor(Math.random() * 6) + 1;

    // Removed 3 consecutive sixes constraint for bots

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, diceResult, gameRoom: updatedRoom });
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
