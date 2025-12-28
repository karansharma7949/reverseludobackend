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
import teamupBotsRouter from './routes/teamupBots.js';

// Bot players service (autonomous realtime bots)
import { startBotPlayersForGameRoom } from './services/botPlayerService.js';

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

// Team up bot routes
app.use('/api/teamup-bots', teamupBotsRouter);

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
    const { noOfPlayers, boardTheme, entryFee } = req.body;
    const userId = req.user.id;

    console.log(`🎯 QUICK MATCH REQUEST:`);
    console.log(`   Player ID: ${userId}`);
    console.log(`   Players needed: ${noOfPlayers}`);
    console.log(`   Board theme: ${boardTheme}`);

    if (![2, 3, 4, 5, 6].includes(noOfPlayers)) {
      return res.status(400).json({ error: 'Number of players must be 2, 3, 4, 5, or 6' });
    }

    const desiredEntryFee = Number(entryFee ?? 0);

    const { data: availableRooms, error: searchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('game_state', 'waiting')
      .eq('no_of_players', noOfPlayers)
      .eq('entry_fee', desiredEntryFee)
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
        entry_fee: desiredEntryFee,
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

app.post('/api/game-rooms/:roomId/exit', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom || !tableName) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    const players = gameRoom.players || {};
    if (!players[userId]) {
      return res.status(400).json({ error: 'Player not in room' });
    }

    const exitedPlayers = [...(gameRoom.exited_players || [])];
    if (!exitedPlayers.includes(userId)) exitedPlayers.push(userId);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        exited_players: exitedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    const isBotId = (id) => id && (id.startsWith('00000000-') || id.startsWith('bot_'));
    const allPlayerIds = Object.keys(players);
    const expectedHumanIds = allPlayerIds.filter((id) => !isBotId(id));
    const allHumansExited = expectedHumanIds.every((id) => exitedPlayers.includes(id));

    if (updatedRoom.game_state === 'finished' && allHumansExited) {
      await supabaseAdmin.from(tableName).delete().eq('room_id', roomId);
      return res.json({ success: true, roomDeleted: true });
    }

    return res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/game-rooms/:roomId/distribute-winner-rewards',
  authenticateUser,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      const { gameRoom, tableName } = await findGameRoom(roomId);
      if (!gameRoom || !tableName) {
        return res.status(404).json({ error: 'Game room not found' });
      }

      if (tableName === 'tournament_rooms') {
        return res.json({ success: true, skipped: true, reason: 'tournament' });
      }

      const players = gameRoom.players || {};
      if (!players[userId]) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (gameRoom.game_state !== 'finished') {
        return res.json({ success: true, skipped: true, reason: 'not_finished' });
      }

      const winners = gameRoom.winners || [];
      if (!winners.length) {
        return res.json({ success: true, skipped: true, reason: 'no_winners' });
      }

      const entryFee = Number(gameRoom.entry_fee ?? 0);
      const winAmount = entryFee * 2;
      if (!winAmount) {
        return res.json({ success: true, skipped: true, reason: 'no_entry_fee' });
      }

      const winnerId = winners[0];
      const isBotId =
        winnerId && (winnerId.startsWith('bot_') || winnerId.startsWith('00000000-'));
      if (isBotId) {
        const { error: markErr } = await supabaseAdmin
          .from(tableName)
          .update({
            payout_processed: true,
            payout_processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('room_id', roomId)
          .eq('payout_processed', false);

        if (markErr) throw markErr;
        return res.json({ success: true, paid: [], skipped: true, reason: 'bot_winner' });
      }

      const { data: payoutLock, error: lockError } = await supabaseAdmin
        .from(tableName)
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

      return res.json({
        success: true,
        paid: [{ userId: winnerId, amount: winAmount }],
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
);

// Create game room
app.post('/api/game-rooms/create', authenticateUser, async (req, res) => {
  try {
    const { noOfPlayers, boardTheme, entryFee } = req.body;
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

    const desiredEntryFee = Number(entryFee ?? 0);

    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_id: roomId,
        host_id: hostId,
        players: players,
        positions: positions,
        no_of_players: noOfPlayers,
        board_theme: boardTheme || 'classic',
        entry_fee: desiredEntryFee,
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
      .update({
        players: updatedPlayers,
        positions: updatedPositions,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('   ✅ Bots added successfully');
    console.log('   Final players:', updatedPlayers);

    // Auto-start if room is now full and still waiting
    const newPlayerCount = Object.keys(updatedPlayers).length;
    if (updatedRoom.game_state === 'waiting' && newPlayerCount >= updatedRoom.no_of_players) {
      const playerIds = Object.keys(updatedPlayers);
      const realPlayers = playerIds.filter(
        (id) => !id.startsWith('bot_') && !id.startsWith('00000000-'),
      );
      const firstTurnPlayer = realPlayers.length > 0 ? realPlayers[0] : playerIds[0];

      const { data: startedRoom, error: startError } = await supabaseAdmin
        .from('game_rooms')
        .update({
          game_state: 'playing',
          turn: firstTurnPlayer,
          dice_state: 'waiting',
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomId)
        .select()
        .single();

      if (!startError && startedRoom) {
        // Start autonomous backend bots for this room
        try {
          const startedBots = await startBotPlayersForGameRoom(roomId);
          console.log(
            `🤖 [FILL-WITH-BOTS] Started ${startedBots.length} autonomous bot players for game room ${roomId}`,
          );
        } catch (e) {
          console.log(
            `⚠️ [FILL-WITH-BOTS] Failed to start autonomous bots for ${roomId}: ${e?.message ?? e}`,
          );
        }

        return res.json({ success: true, gameRoom: startedRoom, autoStarted: true });
      }
    }

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
      const realPlayers = playerIds.filter(
        id => !id.startsWith('bot_') && !id.startsWith('00000000-'),
      );
      const firstTurnPlayer = realPlayers.length > 0 ? realPlayers[0] : playerIds[0];
      
      console.log(`   First turn assigned to: ${firstTurnPlayer} (${updatedPlayers[firstTurnPlayer]})`);
      
      const { data: startedRoom, error: startError } = await supabaseAdmin
        .from('game_rooms')
        .update({ 
          game_state: 'playing', 
          turn: firstTurnPlayer,
          dice_state: 'waiting',
          updated_at: new Date().toISOString(),
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

        // Start autonomous backend bots for this room (they subscribe and play on their own)
        try {
          const startedBots = await startBotPlayersForGameRoom(roomId);
          console.log(
            `🤖 [AUTO-START] Started ${startedBots.length} autonomous bot players for game room ${roomId}`,
          );
        } catch (e) {
          console.log(
            `⚠️ [AUTO-START] Failed to start autonomous bots for ${roomId}: ${e?.message ?? e}`,
          );
        }

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

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom || !tableName) {
      console.log(`   ❌ Game room not found`);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log(`   Current game state: ${gameRoom.game_state}`);
    console.log(`   Room host: ${gameRoom.host_id}`);
    console.log(`   Players: ${JSON.stringify(gameRoom.players)}`);

    if (gameRoom.game_state !== 'waiting') {
      return res.json({ success: true, gameRoom, message: 'Game already started' });
    }

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
    const realPlayers = playerIds.filter(
      id => !id.startsWith('bot_') && !id.startsWith('00000000-'),
    );
    const firstTurnPlayer = realPlayers.length > 0 
      ? realPlayers[Math.floor(Math.random() * realPlayers.length)]
      : playerIds[0]; // Fallback to any player if all are bots
    
    console.log(`   First turn assigned to: ${firstTurnPlayer} (${gameRoom.players[firstTurnPlayer]})`);
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ 
        game_state: 'playing', 
        turn: firstTurnPlayer,
        dice_state: 'waiting',
        updated_at: new Date().toISOString(),
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

    // Start autonomous backend bots for this room (they subscribe and play on their own)
    try {
      const startedBots = await startBotPlayersForGameRoom(roomId);
      console.log(
        `🤖 [START GAME] Started ${startedBots.length} autonomous bot players for game room ${roomId}`,
      );
    } catch (e) {
      console.log(`⚠️ [START GAME] Failed to start autonomous bots for ${roomId}: ${e?.message ?? e}`);
    }

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
    const realPlayers = playerIds.filter(
      id => !id.startsWith('bot_') && !id.startsWith('00000000-'),
    );
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

    // Start autonomous backend bots for this room (they subscribe and play on their own)
    try {
      const startedBots = await startBotPlayersForGameRoom(roomId);
      console.log(
        `🤖 [FORCE-START] Started ${startedBots.length} autonomous bot players for game room ${roomId}`,
      );
    } catch (e) {
      console.log(
        `⚠️ [FORCE-START] Failed to start autonomous bots for ${roomId}: ${e?.message ?? e}`,
      );
    }

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
      const realPlayers = playerIds.filter(
        id => !id.startsWith('bot_') && !id.startsWith('00000000-'),
      );
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
    // FIX: Only update to 'rolling' if not already rolling (idempotent)
    const { data: rollingRoom, error: rollingError } = await supabaseAdmin
      .from(tableName)
      .update({
        dice_result: diceResult,
        dice_state: 'rolling',
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .neq('dice_state', 'rolling') // Only update if not already rolling
      .select()
      .single();

    if (rollingError && rollingError.code !== 'PGRST116') {
      // PGRST116 = no rows updated (already rolling), which is fine
      throw rollingError;
    }

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
              updated_at: new Date().toISOString(),
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
      const nextTurn = getNextTurn(Object.keys(gameRoom.players), userId, gameRoom.players, gameRoom);

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from(tableName)
        .update({
          dice_state: 'waiting',
          dice_result: null,
          turn: nextTurn,
          updated_at: new Date().toISOString(),
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
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
        updated_at: new Date().toISOString(),
      })
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
    const { tokenName, color, newPosition: clientNewPosition } = req.body;

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    const pendingSteps = gameRoom.pending_steps || {};
    let stepsToMove = pendingSteps[userId];

    if (gameRoom.players[userId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to you' });
    }

    const currentPosition = gameRoom.positions[color]?.[tokenName];
    if (currentPosition === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    // CLIENT-FIRST SUPPORT: If pending_steps has not been written yet (race with complete-dice),
    // derive the intended steps from the client-provided newPosition or fall back to dice_result.
    if ((!stepsToMove || stepsToMove <= 0) && typeof clientNewPosition === 'number') {
      if (currentPosition === 0 && clientNewPosition === 1) {
        stepsToMove = 6;
      } else {
        stepsToMove = clientNewPosition - currentPosition;
      }
    }

    if ((!stepsToMove || stepsToMove <= 0) && (gameRoom.dice_result || 0) > 0) {
      stepsToMove = gameRoom.dice_result;
    }

    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    if (currentPosition === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }

    const noOfPlayers = gameRoom.no_of_players || 4;
    const { finalPosition, homePosition } = getBoardConfig(noOfPlayers);

    let newPosition = currentPosition === 0 ? 1 : currentPosition + stepsToMove;

    // If client provided a newPosition and it matches the legal computed move, prefer it.
    // This avoids visual snapback when the server temporarily lags behind client-first UI.
    if (typeof clientNewPosition === 'number') {
      if (clientNewPosition === newPosition) {
        newPosition = clientNewPosition;
      }
    }

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
      nextTurn = getNextTurn(Object.keys(gameRoom.players), userId, gameRoom.players, gameRoom);
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
        updated_at: new Date().toISOString(),
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

    const { gameRoom, tableName } = await findGameRoom(roomId);

    if (!gameRoom || !tableName) {
      console.log(`   ❌ Game room not found`);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log(`   Current game state: ${gameRoom.game_state}`);
    console.log(`   Room host: ${gameRoom.host_id}`);
    console.log(`   Current players: ${JSON.stringify(gameRoom.players)}`);
    console.log(`   Player leaving is host: ${gameRoom.host_id === userId}`);

    const players = gameRoom.players || {};
    const playerColor = players[userId];
    console.log(`   Player was playing as: ${playerColor}`);

    if (!playerColor) {
      console.log(`   ⚠️ Player not in room players map, treating as already-left`);
      return res.json({ success: true, gameRoom });
    }

    const escapedPlayers = [...(gameRoom.escaped_players || [])];
    if (!escapedPlayers.includes(userId)) {
      escapedPlayers.push(userId);
    }

    const updatedPendingSteps = { ...(gameRoom.pending_steps || {}) };
    delete updatedPendingSteps[userId];

    const updatedPositions = { ...(gameRoom.positions || {}) };
    if (updatedPositions[playerColor]) {
      updatedPositions[playerColor] = {
        tokenA: 0,
        tokenB: 0,
        tokenC: 0,
        tokenD: 0,
      };
    }

    let nextTurn = gameRoom.turn;
    let diceState = gameRoom.dice_state;
    let diceResult = gameRoom.dice_result;

    const roomForTurn = {
      ...gameRoom,
      escaped_players: escapedPlayers,
      pending_steps: updatedPendingSteps,
      positions: updatedPositions,
    };

    if (gameRoom.game_state === 'playing' && gameRoom.turn === userId) {
      const playerIds = Object.keys(players);
      nextTurn = getNextTurn(playerIds, userId, players, roomForTurn);
      diceState = 'waiting';
      diceResult = null;
    } else if (nextTurn && (roomForTurn.escaped_players || []).includes(nextTurn)) {
      const playerIds = Object.keys(players);
      nextTurn = getNextTurn(playerIds, nextTurn, players, roomForTurn);
      diceState = 'waiting';
      diceResult = null;
    }

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        escaped_players: escapedPlayers,
        pending_steps: updatedPendingSteps,
        positions: updatedPositions,
        turn: nextTurn,
        dice_state: diceState,
        dice_result: diceResult,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`   ✅ Player ${userId} left room ${roomId} successfully`);
    console.log(`   Remaining players count: ${Object.keys(players).length}`);

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error(`❌ Error leaving game:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Player Disconnect (app background / network lost)
app.post('/api/game-rooms/:roomId/player-disconnect', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom || !tableName) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (tableName !== 'game_rooms' && tableName !== 'tournament_rooms' && tableName !== 'friend_rooms') {
      return res.status(400).json({ error: 'Disconnect not supported for this room type' });
    }

    const players = gameRoom.players || {};
    if (!players[userId]) {
      return res.status(400).json({ error: 'Player not in room' });
    }

    const escapedPlayers = gameRoom.escaped_players || [];
    const kickedPlayers = gameRoom.kicked_players || [];
    if (escapedPlayers.includes(userId) || kickedPlayers.includes(userId)) {
      return res.json({ success: true, gameRoom });
    }

    const disconnectedPlayers = [...(gameRoom.disconnected_players || [])];
    if (!disconnectedPlayers.includes(userId)) disconnectedPlayers.push(userId);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        disconnected_players: disconnectedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;
    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Player Reconnect (app foreground)
app.post('/api/game-rooms/:roomId/player-reconnect', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom || !tableName) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (tableName !== 'game_rooms' && tableName !== 'tournament_rooms' && tableName !== 'friend_rooms') {
      return res.status(400).json({ error: 'Reconnect not supported for this room type' });
    }

    const players = gameRoom.players || {};
    if (!players[userId]) {
      return res.status(400).json({ error: 'Player not in room' });
    }

    const escapedPlayers = gameRoom.escaped_players || [];
    const kickedPlayers = gameRoom.kicked_players || [];
    if (escapedPlayers.includes(userId) || kickedPlayers.includes(userId)) {
      return res.json({ success: true, gameRoom });
    }

    const disconnectedPlayers = [...(gameRoom.disconnected_players || [])].filter(
      (id) => id !== userId,
    );

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        disconnected_players: disconnectedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;
    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Turn timeout (client-side timer expired)
app.post('/api/game-rooms/:roomId/turn-timeout', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    if (tableName !== 'game_rooms' && tableName !== 'tournament_rooms' && tableName !== 'friend_rooms') {
      return res.status(400).json({ error: 'Timeout not supported for this room type' });
    }

    if (gameRoom.game_state !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    if (gameRoom.turn !== userId) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    // Disconnected players are bot-controlled; do not penalize with timeout misses.
    if ((gameRoom.disconnected_players || []).includes(userId)) {
      return res.json({ success: true, gameRoom, ignored: true, reason: 'disconnected_bot_takeover' });
    }

    const players = gameRoom.players || {};
    if (!players[userId]) {
      return res.status(400).json({ error: 'Player not in room' });
    }

    const timeoutMisses = { ...(gameRoom.timeout_misses || {}) };
    const currentMisses = Number(timeoutMisses[userId] || 0);
    const nextMisses = currentMisses + 1;
    timeoutMisses[userId] = nextMisses;

    const escapedPlayers = [...(gameRoom.escaped_players || [])];
    const kickedPlayers = [...(gameRoom.kicked_players || [])];

    const shouldKick = nextMisses >= 6;
    if (shouldKick) {
      if (!kickedPlayers.includes(userId)) kickedPlayers.push(userId);
      if (!escapedPlayers.includes(userId)) escapedPlayers.push(userId);
    }

    const updatedPendingSteps = { ...(gameRoom.pending_steps || {}) };
    delete updatedPendingSteps[userId];

    const roomForTurn = {
      ...gameRoom,
      escaped_players: escapedPlayers,
      kicked_players: kickedPlayers,
      pending_steps: updatedPendingSteps,
      timeout_misses: timeoutMisses,
    };

    const playerIds = Object.keys(players);
    const nextTurn = getNextTurn(playerIds, userId, players, roomForTurn);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        timeout_misses: timeoutMisses,
        escaped_players: escapedPlayers,
        kicked_players: kickedPlayers,
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom, kicked: shouldKick, timeoutMisses: nextMisses });
  } catch (error) {
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

    const { gameRoom, tableName } = await findGameRoom(roomId);
    if (!gameRoom || !tableName) {
      console.log(`   ❌ Game room not found`);
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
    const nextTurn = getNextTurn(playerIds, userId, gameRoom.players, gameRoom);

    console.log(`   Passing turn from ${userId} to ${nextTurn}`);
    console.log(`   Next player color: ${gameRoom.players[nextTurn]}`);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        turn: nextTurn,
        dice_state: 'waiting',
        dice_result: null,
        pending_steps: updatedPendingSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .eq('turn', userId)
      .eq('game_state', 'playing')
      .select()
      .single();

    if (updateError) {
      // If no rows updated, it likely means the turn already advanced (idempotent retry)
      if (updateError.code === 'PGRST116') {
        const { gameRoom: latestRoom } = await findGameRoom(roomId);
        return res.json({ success: true, gameRoom: latestRoom, alreadyPassed: true });
      }
      throw updateError;
    }

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
