import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import routes
import usersRouter from './routes/users.js';
import botsRouter from './routes/bots.js';
import friendRoomsRouter from './routes/friendRooms.js';
import tournamentsRouter from './routes/tournaments.js';
import teamupRouter from './routes/teamup.js';
import chatRouter from './routes/chat.js';

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

// Chat routes (messages and gifts)
app.use('/api/chat', chatRouter);

// ============================================
// GAME ROOM ENDPOINTS
// ============================================

// Quick match
app.post('/api/game-rooms/quick-match', authenticateUser, async (req, res) => {
  try {
    const { noOfPlayers, boardTheme } = req.body;
    const userId = req.user.id;

    console.log(`🎯 QUICK MATCH REQUEST:`);
    console.log(`   Player ID: ${userId}`);
    console.log(`   Players needed: ${noOfPlayers}`);
    console.log(`   Board theme: ${boardTheme}`);

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

    console.log(`   Found ${availableRooms?.length || 0} available rooms`);

    let roomToJoin = null;
    if (availableRooms && availableRooms.length > 0) {
      for (const room of availableRooms) {
        const currentPlayerCount = Object.keys(room.players).length;
        const isPlayerAlreadyInRoom = room.players[userId];
        console.log(`   Checking room ${room.room_id}: ${currentPlayerCount}/${room.no_of_players} players, player already in: ${!!isPlayerAlreadyInRoom}`);
        
        if (currentPlayerCount < room.no_of_players && !isPlayerAlreadyInRoom) {
          roomToJoin = room;
          break;
        }
      }
    }

    if (roomToJoin) {
      console.log(`🔵 JOINING EXISTING ROOM: ${roomToJoin.room_id}`);
      console.log(`   Current players: ${JSON.stringify(roomToJoin.players)}`);
      console.log(`   Room capacity: ${roomToJoin.no_of_players}`);
      
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

    console.log(`🟢 CREATING NEW ROOM: ${roomId}`);
    console.log(`   Host: ${userId}`);
    console.log(`   Capacity: ${noOfPlayers}`);
    console.log(`   Board theme: ${boardTheme || 'classic'}`);
    
    // Use assignColor to get the correct first color based on player count
    // For 2-player: blue (diagonal), for others: red
    const hostColor = assignColor({}, noOfPlayers);
    const players = { [userId]: hostColor };
    const positions = initializePositions(players);

    console.log(`   Host color: ${hostColor}`);
    console.log(`   Initial players: ${JSON.stringify(players)}`);

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

    console.log(`   ✅ NEW ROOM ${roomId} CREATED SUCCESSFULLY`);
    console.log(`   Room state: waiting for ${noOfPlayers - 1} more players`);
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
    const updatedPositions = { ...gameRoom.positions };

    for (let i = 0; i < botsToAdd; i++) {
      // Use fixed bot ID instead of generating random UUID
      const botId = fixedBotIds[i % fixedBotIds.length];
      
      const botColor = assignColor(updatedPlayers, gameRoom.no_of_players);
      
      if (!botColor) {
        console.log('   ❌ No more colors available');
        break;
      }

      console.log(`   🤖 Adding fixed bot ${i + 1}: ${botId} with color ${botColor}`);
      updatedPlayers[botId] = botColor;
      updatedPositions[botColor] = { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 };
    }

    // No need to create bot user entries - they already exist as fixed bots

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

    // Auto-start game if room is now full
    const newPlayerCount = Object.keys(updatedPlayers).length;
    if (newPlayerCount === gameRoom.no_of_players) {
      console.log(`🚀 AUTO-STARTING GAME ${roomId}:`);
      console.log(`   Players joined: ${newPlayerCount}/${gameRoom.no_of_players}`);
      console.log(`   All players: ${JSON.stringify(updatedPlayers)}`);
      
      // Get first player to assign initial turn - prefer real players over bots
      const playerIds = Object.keys(updatedPlayers);
      const realPlayers = playerIds.filter(id => !id.startsWith('bot_'));
      const firstTurnPlayer = realPlayers.length > 0 ? realPlayers[0] : playerIds[0];
      
      console.log(`   First turn assigned to: ${firstTurnPlayer} (${updatedPlayers[firstTurnPlayer]})`);
      
      const { data: startedRoom, error: startError } = await supabaseAdmin
        .from('game_rooms')
        .update({ 
          game_state: 'playing', 
          turn: firstTurnPlayer,
          dice_state: 'waiting'
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (startError) {
        console.error(`❌ ERROR AUTO-STARTING GAME ${roomId}:`, startError);
        res.json({ success: true, gameRoom: updatedRoom });
      } else {
        console.log(`✅ GAME ${roomId} AUTO-STARTED SUCCESSFULLY!`);
        console.log(`   🎯 GAME IS NOW ACTIVE! Turn passed to ${updatedPlayers[firstTurnPlayer]} player (${firstTurnPlayer})`);
        console.log(`   Game State: ${startedRoom.game_state}`);
        console.log(`   Turn: ${startedRoom.turn}`);
        console.log(`   Dice State: ${startedRoom.dice_state}`);
        res.json({ success: true, gameRoom: startedRoom, autoStarted: true });
      }
    } else {
      console.log(`⏳ Game ${roomId} waiting for more players: ${newPlayerCount}/${gameRoom.no_of_players}`);
      res.json({ success: true, gameRoom: updatedRoom });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start game
app.post('/api/game-rooms/:roomId/start', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🎮 MANUAL START GAME REQUEST:`);
    console.log(`   Room ID: ${roomId}`);
    console.log(`   Host ID: ${userId}`);

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      console.log(`   ❌ Game room not found: ${fetchError?.message}`);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log(`   Current game state: ${gameRoom.game_state}`);
    console.log(`   Room host: ${gameRoom.host_id}`);
    console.log(`   Players: ${JSON.stringify(gameRoom.players)}`);

    if (gameRoom.host_id !== userId) {
      console.log(`   ❌ Not host - cannot start game`);
      return res.status(403).json({ error: 'Only host can start the game' });
    }

    const playerIds = Object.keys(gameRoom.players);
    if (playerIds.length < 2) {
      console.log(`   ❌ Not enough players: ${playerIds.length}`);
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    // Always give first turn to a real player (not bot)
    const realPlayers = playerIds.filter(id => !id.startsWith('bot_'));
    const firstTurnPlayer = realPlayers.length > 0 
      ? realPlayers[Math.floor(Math.random() * realPlayers.length)]
      : playerIds[0]; // Fallback to any player if all are bots
    
    console.log(`   First turn assigned to: ${firstTurnPlayer} (${gameRoom.players[firstTurnPlayer]})`);
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ 
        game_state: 'playing', 
        turn: firstTurnPlayer,
        dice_state: 'waiting'
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ GAME ${roomId} MANUALLY STARTED SUCCESSFULLY!`);
    console.log(`   🎯 GAME IS NOW ACTIVE! Turn passed to ${gameRoom.players[firstTurnPlayer]} player (${firstTurnPlayer})`);
    console.log(`   Game State: ${updatedRoom.game_state}`);
    console.log(`   Turn: ${updatedRoom.turn}`);
    console.log(`   Dice State: ${updatedRoom.dice_state}`);

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error(`❌ Error starting game:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Force start stuck games (for matchmaking rooms that didn't auto-start)
app.post('/api/game-rooms/:roomId/force-start', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.game_state !== 'waiting') {
      return res.json({ success: true, gameRoom, message: 'Game already started' });
    }

    const playerIds = Object.keys(gameRoom.players);
    if (playerIds.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    console.log(`🔧 FORCE-STARTING STUCK GAME ${roomId}:`);
    console.log(`   Players: ${playerIds.length}`);
    console.log(`   Player details: ${JSON.stringify(gameRoom.players)}`);

    // Always give first turn to a real player (not bot)
    const realPlayers = playerIds.filter(id => !id.startsWith('bot_'));
    const firstTurnPlayer = realPlayers.length > 0 
      ? realPlayers[Math.floor(Math.random() * realPlayers.length)]
      : playerIds[0];

    console.log(`   First turn assigned to: ${firstTurnPlayer} (${gameRoom.players[firstTurnPlayer]})`);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ 
        game_state: 'playing', 
        turn: firstTurnPlayer,
        dice_state: 'waiting'
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ GAME ${roomId} FORCE-STARTED SUCCESSFULLY!`);
    console.log(`   🎯 GAME IS NOW ACTIVE! Turn passed to ${gameRoom.players[firstTurnPlayer]} player (${firstTurnPlayer})`);
    console.log(`   Game State: ${updatedRoom.game_state}`);
    console.log(`   Turn: ${updatedRoom.turn}`);
    console.log(`   Dice State: ${updatedRoom.dice_state}`);
    res.json({ success: true, gameRoom: updatedRoom, forceStarted: true });
  } catch (error) {
    console.error(`❌ Error force-starting game:`, error);
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: Fix turn assignment for stuck games
app.post('/api/game-rooms/:roomId/fix-turn', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log('🔧 FIXING TURN ASSIGNMENT FOR ROOM:', roomId);
    console.log('   Current turn:', gameRoom.turn);
    console.log('   Game state:', gameRoom.game_state);
    console.log('   Dice state:', gameRoom.dice_state);
    console.log('   Players:', gameRoom.players);

    // If game is playing but turn is null, assign turn to red player
    if (gameRoom.game_state === 'playing' && !gameRoom.turn) {
      const playerIds = Object.keys(gameRoom.players);
      const realPlayers = playerIds.filter(id => !id.startsWith('bot_'));
      const firstTurnPlayer = realPlayers.length > 0 
        ? realPlayers[0] // Give to first real player
        : playerIds[0]; // Fallback to any player

      console.log('   🔧 Assigning turn to:', firstTurnPlayer);

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('game_rooms')
        .update({ turn: firstTurnPlayer, dice_state: 'waiting' })
        .eq('room_id', roomId)
        .select()
        .single();

      if (updateError) throw updateError;

      console.log('   ✅ Turn fixed successfully');
      return res.json({ success: true, gameRoom: updatedRoom, fixed: true });
    }

    res.json({ success: true, gameRoom, fixed: false, message: 'No fix needed' });
  } catch (error) {
    console.error('Error fixing turn:', error);
    res.status(500).json({ error: error.message });
  }
});

// Roll dice
// CLIENT-FIRST: Accepts optional diceResult from client for instant gameplay
// If client provides diceResult, we validate and use it
// If not provided, we generate server-side (backward compatible)
app.post('/api/game-rooms/:roomId/roll-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const { diceResult: clientDiceResult } = req.body; // CLIENT-FIRST: Accept client dice result

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

    // CLIENT-FIRST: Use client dice result if provided and valid, otherwise generate server-side
    let diceResult;
    if (clientDiceResult !== undefined && clientDiceResult >= 1 && clientDiceResult <= 6) {
      diceResult = clientDiceResult;
      console.log(`🎲 [ClientFirst] Using client-provided dice result: ${diceResult}`);
    } else {
      diceResult = Math.floor(Math.random() * 6) + 1;
      console.log(`🎲 [ServerFirst] Generated server dice result: ${diceResult}`);
    }

    // Removed 3 consecutive sixes constraint - players can keep rolling

    // First update with rolling state for frontend animation
    const { data: rollingRoom, error: rollingError } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (rollingError) throw rollingError;

    // After a short delay, automatically set to complete state
    // BUT only if the dice is still in 'rolling' state (prevents race condition with move-token)
    setTimeout(async () => {
      try {
        // First check current state - only update if still rolling
        const { data: currentRoom } = await supabaseAdmin
          .from(tableName)
          .select('dice_state, turn')
          .eq('room_id', roomId)
          .single();
        
        // Only auto-complete if dice is still rolling AND it's still the same player's turn
        if (currentRoom && currentRoom.dice_state === 'rolling' && currentRoom.turn === userId) {
          await supabaseAdmin
            .from(tableName)
            .update({
              dice_state: 'complete',
            })
            .eq('room_id', roomId);
          
          console.log(`🎲 Auto-completed dice for room ${roomId} with result ${diceResult}`);
        } else {
          console.log(`🎲 Skipped auto-complete for room ${roomId} - state already changed (dice_state: ${currentRoom?.dice_state}, turn: ${currentRoom?.turn})`);
        }
      } catch (error) {
        console.error(`Error auto-completing dice for room ${roomId}:`, error);
      }
    }, 1200); // 1.2 seconds - enough time for frontend animation

    res.json({ success: true, diceResult, gameRoom: rollingRoom });
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

    // Accept both 'complete' and 'rolling' states (for backward compatibility)
    if (gameRoom.dice_state !== 'complete' && gameRoom.dice_state !== 'rolling') {
      return res.status(400).json({ error: 'Dice is not in a completable state' });
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

    // Check if token reached finish position (bonus turn)
    const tokenReachedFinish = newPosition === homePosition;
    if (tokenReachedFinish) {
      console.log(`🏠 Token reached finish! Player gets bonus turn.`);
    }

    let nextTurn = userId;
    // Player keeps turn if: rolled 6, killed opponent, OR token reached finish
    if (stepsToMove !== 6 && !bonusRoll && !tokenReachedFinish) {
      nextTurn = getNextTurn(Object.keys(gameRoom.players), userId);
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
    res.status(500).json({ error: error.message });
  }
});

// Leave game room
app.post('/api/game-rooms/:roomId/leave', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🚪 PLAYER LEAVING GAME:`);
    console.log(`   Room ID: ${roomId}`);
    console.log(`   Player ID: ${userId}`);

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      console.log(`   ❌ Game room not found: ${fetchError?.message}`);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log(`   Current game state: ${gameRoom.game_state}`);
    console.log(`   Room host: ${gameRoom.host_id}`);
    console.log(`   Current players: ${JSON.stringify(gameRoom.players)}`);
    console.log(`   Player leaving is host: ${gameRoom.host_id === userId}`);

    if (gameRoom.host_id === userId) {
      console.log(`   🗑️ Host leaving - deleting entire room`);
      const { error: deleteError } = await supabaseAdmin
        .from('game_rooms')
        .delete()
        .eq('room_id', roomId);

      if (deleteError) throw deleteError;

      console.log(`   ✅ Room ${roomId} deleted successfully`);
      return res.json({ success: true, message: 'Game room deleted' });
    }

    const updatedPlayers = { ...gameRoom.players };
    const playerColor = updatedPlayers[userId];
    delete updatedPlayers[userId];
    
    console.log(`   Player was playing as: ${playerColor}`);
    console.log(`   Remaining players: ${JSON.stringify(updatedPlayers)}`);
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ players: updatedPlayers })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`   ✅ Player ${userId} left room ${roomId} successfully`);
    console.log(`   Remaining players count: ${Object.keys(updatedPlayers).length}`);

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error(`❌ Error leaving game:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Pass turn (for timer timeout or manual skip)
app.post('/api/game-rooms/:roomId/pass-turn', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log(`🔄 PASS TURN REQUEST:`);
    console.log(`   Room ID: ${roomId}`);
    console.log(`   Player ID: ${userId}`);

    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      console.log(`   ❌ Game room not found: ${fetchError?.message}`);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log(`   Current game state: ${gameRoom.game_state}`);
    console.log(`   Current turn: ${gameRoom.turn}`);
    console.log(`   Dice state: ${gameRoom.dice_state}`);
    console.log(`   Pending steps: ${JSON.stringify(gameRoom.pending_steps)}`);

    if (gameRoom.game_state !== 'playing') {
      console.log(`   ❌ Game not in playing state: ${gameRoom.game_state}`);
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    if (gameRoom.turn !== userId) {
      console.log(`   ❌ Not player's turn: ${gameRoom.turn} vs ${userId}`);
      return res.status(400).json({ error: 'Not your turn' });
    }

    // Clear any pending steps for this player
    const updatedPendingSteps = { ...gameRoom.pending_steps };
    delete updatedPendingSteps[userId];

    // Pass turn logic

    // Get next player
    const playerIds = Object.keys(gameRoom.players);
    const nextTurn = getNextTurn(playerIds, userId);

    console.log(`   Passing turn from ${userId} to ${nextTurn}`);
    console.log(`   Next player color: ${gameRoom.players[nextTurn]}`);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ TURN PASSED SUCCESSFULLY!`);
    console.log(`   🎯 TURN PASSED TO ${gameRoom.players[nextTurn]} player (${nextTurn})`);
    console.log(`   New dice state: ${updatedRoom.dice_state}`);

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error(`❌ Error passing turn:`, error);
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
