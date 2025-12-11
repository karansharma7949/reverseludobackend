import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import routes
import usersRouter from './routes/users.js';
import botsRouter from './routes/bots.js';
import friendRoomsRouter from './routes/friendRooms.js';
import tournamentsRouter from './routes/tournaments.js';
import teamupRouter from './routes/teamup.js';

// Import config
import { supabaseAdmin } from './config/supabase.js';

// Import middleware
import { authenticateUser } from './middleware/auth.js';

// Import helpers
import {
  generateRoomId,
  assignColor,
  initializePositions,
  getBoardPosition,
  arePositionsSame,
  getStarPositions,
  getBoardConfig,
  checkForKills,
  hasValidMoves,
  checkAllTokensHome,
  getNextTurn,
  generateBotId
} from './utils/gameHelpers.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================
// ROUTES
// ============================================

// User routes
app.use('/api/users', usersRouter);

// Bot routes
app.use('/api/game-rooms', botsRouter);

// Team up routes
app.use('/api/team-up-rooms', teamupRouter);

// Friend room routes
app.use('/api/friend-rooms', friendRoomsRouter);

// Tournament routes
app.use('/api/tournaments', tournamentsRouter);

// ============================================
// GAME ROOM ENDPOINTS
// ============================================

// Quick match
app.post('/api/game-rooms/quick-match', authenticateUser, async (req, res) => {
  try {
    const { noOfPlayers, boardTheme } = req.body;
    const userId = req.user.id;

    if (![2, 3, 4, 5, 6].includes(noOfPlayers)) {
      return res.status(400).json({ error: 'Number of players must be 2, 3, 4, 5, or 6' });
    }

    const { data: availableRooms, error: searchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('game_state', 'waiting')
      .eq('no_of_players', noOfPlayers)
      .order('created_at', { ascending: true });

    if (searchError) throw searchError;

    let roomToJoin = null;
    if (availableRooms && availableRooms.length > 0) {
      for (const room of availableRooms) {
        const currentPlayerCount = Object.keys(room.players).length;
        if (currentPlayerCount < room.no_of_players && !room.players[userId]) {
          roomToJoin = room;
          break;
        }
      }
    }

    if (roomToJoin) {
      console.log('🔵 JOINING EXISTING ROOM:', roomToJoin.room_id);
      console.log('   Current players:', roomToJoin.players);
      console.log('   Room capacity:', roomToJoin.no_of_players);
      
      const assignedColor = assignColor(roomToJoin.players, roomToJoin.no_of_players);
      
      if (!assignedColor) {
        console.log('   ❌ No available colors');
        return res.status(400).json({ error: 'No available colors' });
      }

      console.log('   ✅ Player', userId, 'assigned color:', assignedColor);

      const updatedPlayers = { ...roomToJoin.players, [userId]: assignedColor };
      const updatedPositions = {
        ...roomToJoin.positions,
        [assignedColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
      };
      
      console.log('   Updated players:', updatedPlayers);
      
      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('game_rooms')
        .update({ players: updatedPlayers, positions: updatedPositions })
        .eq('room_id', roomToJoin.room_id)
        .select()
        .single();

      if (updateError) throw updateError;

      console.log('   ✅ Room updated successfully');
      return res.json({ success: true, gameRoom: updatedRoom, action: 'joined' });
    }

    // Create new room
    let roomId;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      roomId = generateRoomId();
      const { data: existing } = await supabaseAdmin
        .from('game_rooms')
        .select('room_id')
        .eq('room_id', roomId)
        .single();

      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique room ID' });
    }

    console.log('🟢 CREATING NEW ROOM:', roomId);
    console.log('   Host:', userId);
    console.log('   Capacity:', noOfPlayers);
    
    const hostColor = 'red';
    const players = { [userId]: hostColor };
    const positions = initializePositions(players);

    console.log('   Host color:', hostColor);
    console.log('   Initial players:', players);

    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_id: roomId,
        host_id: userId,
        players: players,
        positions: positions,
        no_of_players: noOfPlayers,
        board_theme: boardTheme || 'classic',
        dice_state: 'waiting',
        dice_result: null,
        game_state: 'waiting',
        turn: null,
      })
      .select()
      .single();

    if (error) throw error;

    console.log('   ✅ Room created successfully');
    res.json({ success: true, gameRoom, action: 'created' });
  } catch (error) {
    console.error('Error in quick match:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create game room
app.post('/api/game-rooms/create', authenticateUser, async (req, res) => {
  try {
    const { noOfPlayers, boardTheme } = req.body;
    const hostId = req.user.id;

    if (![2, 3, 4, 5, 6].includes(noOfPlayers)) {
      return res.status(400).json({ error: 'Number of players must be 2, 3, 4, 5, or 6' });
    }

    let roomId;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      roomId = generateRoomId();
      const { data: existing } = await supabaseAdmin
        .from('game_rooms')
        .select('room_id')
        .eq('room_id', roomId)
        .single();

      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique room ID' });
    }

    const hostColor = 'red';
    const players = { [hostId]: hostColor };
    const positions = initializePositions(players);

    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_id: roomId,
        host_id: hostId,
        players: players,
        positions: positions,
        no_of_players: noOfPlayers,
        board_theme: boardTheme || 'classic',
        dice_state: 'waiting',
        dice_result: null,
        game_state: 'waiting',
        turn: null,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, gameRoom });
  } catch (error) {
    console.error('Error creating game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fill room with bots
app.post('/api/game-rooms/:roomId/fill-with-bots', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { numberOfBots } = req.body;

    console.log('🤖 FILLING ROOM WITH BOTS:', roomId);
    console.log('   Number of bots requested:', numberOfBots);

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    const currentPlayers = gameRoom.players || {};
    const emptySlots = gameRoom.no_of_players - Object.keys(currentPlayers).length;
    const botsToAdd = Math.min(numberOfBots, emptySlots);

    console.log('   Current players:', currentPlayers);
    console.log('   Empty slots:', emptySlots);
    console.log('   Bots to add:', botsToAdd);

    if (botsToAdd <= 0) {
      return res.json({ success: true, gameRoom });
    }

    // Realistic bot names to mimic real players
    const botNames = [
      'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley',
      'Sam', 'Jamie', 'Chris', 'Pat', 'Drew', 'Quinn',
      'Avery', 'Blake', 'Cameron', 'Dakota', 'Emerson', 'Finley',
      'Harper', 'Hayden', 'Jesse', 'Kai', 'Logan', 'Micah',
      'Noah', 'Parker', 'Reese', 'Rowan', 'Sage', 'Skylar'
    ];

    const updatedPlayers = { ...currentPlayers };
    const updatedPositions = { ...gameRoom.positions };
    const botUserEntries = [];

    for (let i = 0; i < botsToAdd; i++) {
      // Generate proper UUID v4 for bot
      const botId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      
      const botColor = assignColor(updatedPlayers, gameRoom.no_of_players);
      
      if (!botColor) {
        console.log('   ❌ No more colors available');
        break;
      }

      const botName = botNames[Math.floor(Math.random() * botNames.length)] + Math.floor(Math.random() * 999);

      console.log(`   🤖 Adding bot ${i + 1}: ${botId} (${botName}) with color ${botColor}`);
      updatedPlayers[botId] = botColor;
      updatedPositions[botColor] = { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 };

      // Create fake user entry so bot appears as real player
      botUserEntries.push({
        uid: botId,
        username: botName,
        total_coins: 0,
        total_diamonds: 0,
        profile_image_url: null
      });
    }

    // Insert bot user entries (upsert to avoid conflicts)
    if (botUserEntries.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('users')
        .upsert(botUserEntries, { onConflict: 'uid' });

      if (insertError) {
        console.error('   ⚠️ Error creating bot users:', insertError);
        // Continue anyway, bots will just show as "Player X"
      } else {
        console.log('   ✅ Bot users created in database');
      }
    }

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ players: updatedPlayers, positions: updatedPositions })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('   ✅ Bots added successfully');
    console.log('   Final players:', updatedPlayers);
    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error filling room with bots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get game room
app.get('/api/game-rooms/:roomId', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;

    const { data: gameRoom, error} = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (error || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    res.json({ success: true, gameRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Join game room
app.post('/api/game-rooms/:roomId/join', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const playerId = req.user.id;

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.game_state !== 'waiting') {
      return res.status(400).json({ error: 'Game has already started' });
    }

    if (gameRoom.players[playerId]) {
      return res.json({ success: true, gameRoom, message: 'Already in room' });
    }

    const currentPlayerCount = Object.keys(gameRoom.players).length;
    if (currentPlayerCount >= gameRoom.no_of_players) {
      return res.status(400).json({ error: 'Game room is full' });
    }

    const assignedColor = assignColor(gameRoom.players, gameRoom.no_of_players);
    if (!assignedColor) {
      return res.status(400).json({ error: 'No available colors' });
    }

    const updatedPlayers = { ...gameRoom.players, [playerId]: assignedColor };
    const updatedPositions = {
      ...gameRoom.positions,
      [assignedColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
    };
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ players: updatedPlayers, positions: updatedPositions })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start game
app.post('/api/game-rooms/:roomId/start', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.host_id !== userId) {
      return res.status(403).json({ error: 'Only host can start the game' });
    }

    const playerIds = Object.keys(gameRoom.players);
    if (playerIds.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    // Always give first turn to a real player (not bot)
    const realPlayers = playerIds.filter(id => !id.startsWith('bot_'));
    const firstTurnPlayer = realPlayers.length > 0 
      ? realPlayers[Math.floor(Math.random() * realPlayers.length)]
      : playerIds[0]; // Fallback to any player if all are bots
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ game_state: 'playing', turn: firstTurnPlayer })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Roll dice
app.post('/api/game-rooms/:roomId/roll-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    if (gameRoom.game_state !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    if (pendingSteps[userId] && pendingSteps[userId] > 0) {
      return res.status(400).json({ error: 'You must move a token first' });
    }

    const diceResult = Math.floor(Math.random() * 6) + 1;

    const consecutiveSixes = gameRoom.consecutive_sixes || {};
    let currentCount = consecutiveSixes[userId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    if (currentCount >= 3) {
      const updatedConsecutiveSixes = { ...consecutiveSixes, [userId]: 0 };
      const nextTurn = getNextTurn(Object.keys(gameRoom.players), userId);
      
      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from(tableName)
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

    const updatedConsecutiveSixes = { ...consecutiveSixes, [userId]: currentCount };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
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
    res.status(500).json({ error: error.message });
  }
});

// Complete dice
app.post('/api/game-rooms/:roomId/complete-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.dice_state === 'waiting') {
      return res.json({ success: true, alreadyCompleted: true, gameRoom });
    }

    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    const diceResult = gameRoom.dice_result || 0;
    const playerColor = gameRoom.players[userId];
    const playerPositions = gameRoom.positions[playerColor] || {};
    const noOfPlayers = gameRoom.no_of_players || 4;

    const validMove = hasValidMoves(playerPositions, diceResult, noOfPlayers);

    if (!validMove) {
      const nextTurn = getNextTurn(Object.keys(gameRoom.players), userId);
      const consecutiveSixes = gameRoom.consecutive_sixes || {};
      if (diceResult !== 6) consecutiveSixes[userId] = 0;

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from(tableName)
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
    pendingSteps[userId] = diceResult;

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({ dice_state: 'complete', pending_steps: pendingSteps })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move token
app.post('/api/game-rooms/:roomId/move-token', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const { tokenName, color } = req.body;

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    const stepsToMove = pendingSteps[userId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    if (gameRoom.players[userId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to you' });
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
    
    if (allTokensHome && !updatedWinners.includes(userId)) {
      updatedWinners.push(userId);
    }

    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[userId];

    let nextTurn = userId;
    if (stepsToMove !== 6 && !bonusRoll) {
      nextTurn = getNextTurn(Object.keys(gameRoom.players), userId);
    }

    // Reset consecutive sixes when turn passes to another player
    const consecutiveSixes = gameRoom.consecutive_sixes || {};
    if (nextTurn !== userId) {
      consecutiveSixes[userId] = 0;
    }

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
        consecutive_sixes: consecutiveSixes,
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom, bonusRoll, killed: bonusRoll });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Leave game room
app.post('/api/game-rooms/:roomId/leave', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.host_id === userId) {
      const { error: deleteError } = await supabaseAdmin
        .from('game_rooms')
        .delete()
        .eq('room_id', roomId);

      if (deleteError) throw deleteError;

      return res.json({ success: true, message: 'Game room deleted' });
    }

    const updatedPlayers = { ...gameRoom.players };
    delete updatedPlayers[userId];
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ players: updatedPlayers })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to find room in game_rooms, tournament_rooms, or friend_rooms
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

  // If not found, try tournament_rooms
  const { data: tournamentRoom, error: tournamentError } = await supabaseAdmin
    .from('tournament_rooms')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (tournamentRoom) {
    return { gameRoom: tournamentRoom, tableName: 'tournament_rooms' };
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

  return { gameRoom: null, tableName: null };
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`\nBackend is accessible from any device on your network!`);
});
