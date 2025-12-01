import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import {
  getBoardConfig,
  checkForKills,
  hasValidMoves,
  checkAllTokensHome,
  getNextTurn,
  generateBotId
} from '../utils/gameHelpers.js';

const router = express.Router();

// Bot Roll Dice (No auth required - bot sends its own ID)
router.post('/:roomId/bot-roll-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
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

    const consecutiveSixes = gameRoom.consecutive_sixes || {};
    let currentCount = consecutiveSixes[botUserId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    if (currentCount >= 3) {
      const updatedConsecutiveSixes = { ...consecutiveSixes, [botUserId]: 0 };
      const nextTurn = getNextTurn(Object.keys(gameRoom.players), botUserId);
      
      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('game_rooms')
        .update({
          consecutive_sixes: updatedConsecutiveSixes,
          turn: nextTurn,
          dice_result: null,
          dice_state: 'waiting',
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ success: true, turnCancelled: true, gameRoom: updatedRoom });
    }

    const updatedConsecutiveSixes = { ...consecutiveSixes, [botUserId]: currentCount };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        consecutive_sixes: updatedConsecutiveSixes,
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

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
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
      const consecutiveSixes = gameRoom.consecutive_sixes || {};
      if (diceResult !== 6) consecutiveSixes[botUserId] = 0;

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('game_rooms')
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
          consecutive_sixes: consecutiveSixes,
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
      .from('game_rooms')
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

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
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

    let nextTurn = botUserId;
    if (stepsToMove !== 6 && !bonusRoll) {
      nextTurn = getNextTurn(Object.keys(gameRoom.players), botUserId);
    }

    const gameFinished = updatedWinners.length >= Object.keys(gameRoom.players).length - 1;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
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
    const availableColors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
    const usedColors = Object.values(currentPlayers);
    const freeColors = availableColors.filter(color => !usedColors.includes(color));

    const botNames = [
      'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley',
      'Sam', 'Jamie', 'Chris', 'Pat', 'Drew', 'Quinn'
    ];

    // Bot avatar URLs (using UI Avatars API for consistent bot avatars)
    const botAvatars = [
      'https://ui-avatars.com/api/?name=Bot&background=FF6B6B&color=fff&size=128',
      'https://ui-avatars.com/api/?name=Bot&background=4ECDC4&color=fff&size=128',
      'https://ui-avatars.com/api/?name=Bot&background=45B7D1&color=fff&size=128',
      'https://ui-avatars.com/api/?name=Bot&background=96CEB4&color=fff&size=128',
      'https://ui-avatars.com/api/?name=Bot&background=FFEAA7&color=333&size=128',
      'https://ui-avatars.com/api/?name=Bot&background=DDA0DD&color=fff&size=128',
    ];

    const updatedPlayers = { ...currentPlayers };
    const botUserEntries = [];

    for (let i = 0; i < botsToAdd; i++) {
      if (freeColors.length === 0) break;
      
      const botId = generateBotId();
      const botColor = freeColors.shift();
      const botName = botNames[Math.floor(Math.random() * botNames.length)] + Math.floor(Math.random() * 999);
      const botAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(botName)}&background=random&color=fff&size=128&bold=true`;
      
      updatedPlayers[botId] = botColor;
      
      botUserEntries.push({
        uid: botId,
        username: botName,
        total_coins: 0,
        total_diamonds: 0,
        profile_image_url: botAvatar
      });
    }

    if (botUserEntries.length > 0) {
      await supabaseAdmin
        .from('users')
        .upsert(botUserEntries, { onConflict: 'uid' });
    }

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
