import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import { assignColor, initializePositions, getNextTurn } from '../utils/gameHelpers.js';

const router = express.Router();

// Generate 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create friend room
router.post('/create', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { noOfPlayers, dare, entryFee } = req.body;

    if (!noOfPlayers || noOfPlayers < 2 || noOfPlayers > 6) {
      return res.status(400).json({ error: 'Invalid number of players (must be 2-6)' });
    }

    console.log('🏠 Creating friend room for', noOfPlayers, 'players');

    let roomCode;
    let isUnique = false;
    while (!isUnique) {
      roomCode = generateRoomCode();
      const { data: existing } = await supabaseAdmin
        .from('friend_rooms')
        .select('id')
        .eq('room_id', roomCode)
        .single();
      if (!existing) isUnique = true;
    }

    // Use assignColor helper for consistent anti-clockwise turn order
    const firstColor = assignColor({}, noOfPlayers);
    const players = { [userId]: firstColor };
    const positions = { [firstColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 } };

    const { data: friendRoom, error } = await supabaseAdmin
      .from('friend_rooms')
      .insert({
        room_id: roomCode,
        host_id: userId,
        players: players,
        positions: positions,
        no_of_players: noOfPlayers,
        board_theme: 'classic',
        entry_fee: Number(entryFee ?? 0),
        game_state: 'waiting',
        dice_state: 'waiting',
        pending_steps: {},
        consecutive_sixes: {},
        winners: [],
        dare: dare || null,
      })
      .select()
      .single();
    
    console.log('✅ Friend room created:', roomCode);

    if (error) throw error;

    res.json({ friendRoom });
  } catch (error) {
    console.error('Error creating friend room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join friend room
router.post('/:roomCode/join', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;

    const { data: friendRoom, error: fetchError } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (fetchError || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (friendRoom.game_state !== 'waiting') {
      return res.status(400).json({ error: 'Room is not accepting players' });
    }

    if (friendRoom.players[userId]) {
      return res.json({ friendRoom });
    }

    if (Object.keys(friendRoom.players).length >= friendRoom.no_of_players) {
      return res.status(400).json({ error: 'Room is full' });
    }

    // Use assignColor helper for consistent anti-clockwise turn order
    const nextColor = assignColor(friendRoom.players, friendRoom.no_of_players);

    const updatedPlayers = { ...friendRoom.players, [userId]: nextColor };
    const updatedPositions = {
      ...friendRoom.positions,
      [nextColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
    };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({
        players: updatedPlayers,
        positions: updatedPositions,
      })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ friendRoom: updatedRoom });
  } catch (error) {
    console.error('Error joining friend room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get friend room
router.get('/:roomCode', authenticateUser, async (req, res) => {
  try {
    const { roomCode } = req.params;

    const { data: friendRoom, error } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (error || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ friendRoom });
  } catch (error) {
    console.error('Error getting friend room:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:roomCode/exit', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;

    const { data: friendRoom, error: fetchError } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (fetchError || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const players = friendRoom.players || {};
    if (!players[userId]) {
      return res.status(400).json({ error: 'Player not in room' });
    }

    const exitedPlayers = [...(friendRoom.exited_players || [])];
    if (!exitedPlayers.includes(userId)) exitedPlayers.push(userId);

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({
        exited_players: exitedPlayers,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    const isBotId = (id) => id && (id.startsWith('00000000-') || id.startsWith('bot_'));
    const expectedHumanIds = Object.keys(players).filter((id) => !isBotId(id));
    const allHumansExited = expectedHumanIds.every((id) => exitedPlayers.includes(id));

    if (updatedRoom.game_state === 'finished' && allHumansExited) {
      await supabaseAdmin.from('friend_rooms').delete().eq('room_id', roomCode);
      return res.json({ success: true, roomDeleted: true });
    }

    return res.json({ success: true, friendRoom: updatedRoom });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Leave friend room
router.post('/:roomCode/leave', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;

    const { data: friendRoom, error: fetchError } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (fetchError || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // If game is in progress, treat leave as ESCAPE (do not remove from players)
    if (friendRoom.game_state === 'playing') {
      const players = friendRoom.players || {};
      const playerColor = players[userId];

      if (!playerColor) {
        return res.json({ success: true, friendRoom });
      }

      const escapedPlayers = [...(friendRoom.escaped_players || [])];
      if (!escapedPlayers.includes(userId)) {
        escapedPlayers.push(userId);
      }

      const updatedPendingSteps = { ...(friendRoom.pending_steps || {}) };
      delete updatedPendingSteps[userId];

      const updatedPositions = { ...(friendRoom.positions || {}) };
      if (updatedPositions[playerColor]) {
        updatedPositions[playerColor] = { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 };
      }

      let nextTurn = friendRoom.turn;
      let diceState = friendRoom.dice_state;
      let diceResult = friendRoom.dice_result;

      const roomForTurn = {
        ...friendRoom,
        escaped_players: escapedPlayers,
        pending_steps: updatedPendingSteps,
        positions: updatedPositions,
      };

      if (friendRoom.turn === userId) {
        const playerIds = Object.keys(players);
        nextTurn = getNextTurn(playerIds, userId, players, roomForTurn);
        diceState = 'waiting';
        diceResult = null;
      }

      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('friend_rooms')
        .update({
          escaped_players: escapedPlayers,
          pending_steps: updatedPendingSteps,
          positions: updatedPositions,
          turn: nextTurn,
          dice_state: diceState,
          dice_result: diceResult,
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', roomCode)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ success: true, friendRoom: updatedRoom, escaped: true });
    }

    if (friendRoom.host_id === userId) {
      const { error: deleteError } = await supabaseAdmin
        .from('friend_rooms')
        .delete()
        .eq('room_id', roomCode);

      if (deleteError) throw deleteError;

      return res.json({ success: true, message: 'Room deleted' });
    }

    const playerColor = friendRoom.players[userId];
    const updatedPlayers = { ...friendRoom.players };
    delete updatedPlayers[userId];

    const updatedPositions = { ...friendRoom.positions };
    delete updatedPositions[playerColor];

    const updatedPendingSteps = { ...(friendRoom.pending_steps || {}) };
    delete updatedPendingSteps[userId];

    let nextTurn = friendRoom.turn;
    let diceState = friendRoom.dice_state;
    let diceResult = friendRoom.dice_result;

    if (friendRoom.game_state === 'playing' && friendRoom.turn === userId) {
      const remainingIds = Object.keys(updatedPlayers);
      const tempPlayers = { ...updatedPlayers, [userId]: playerColor };
      const tempIds = Object.keys(tempPlayers);
      nextTurn = remainingIds.length > 0
        ? getNextTurn(tempIds, userId, tempPlayers, friendRoom)
        : null;
      diceState = 'waiting';
      diceResult = null;
    }

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({
        players: updatedPlayers,
        positions: updatedPositions,
        pending_steps: updatedPendingSteps,
        turn: nextTurn,
        dice_state: diceState,
        dice_result: diceResult,
      })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, friendRoom: updatedRoom });
  } catch (error) {
    console.error('Error leaving friend room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start friend game (NO bots - friends only)
router.post('/:roomCode/start', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;

    const { data: friendRoom, error: fetchError } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (fetchError || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (friendRoom.host_id !== userId) {
      return res.status(403).json({ error: 'Only host can start the game' });
    }

    const playerIds = Object.keys(friendRoom.players);
    
    if (playerIds.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    // Give first turn to a random player
    const firstTurn = playerIds[Math.floor(Math.random() * playerIds.length)];

    // Initialize mic_state for all players (default: mic off, not speaking)
    const micState = {};
    playerIds.forEach(playerId => {
      micState[playerId] = { mic: 'off', speaking: false };
    });

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ 
        game_state: 'playing', 
        turn: firstTurn,
        mic_state: micState
      })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ Friend game started: ${roomCode} with ${playerIds.length} players`);
    res.json({ friendRoom: updatedRoom });
  } catch (error) {
    console.error('Error starting friend game:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update mic state (toggle mic on/off, update speaking status)
router.post('/:roomCode/mic-state', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;
    const { micState, speaking } = req.body; // micState: 'on' | 'off', speaking: boolean

    const { data: friendRoom, error: fetchError } = await supabaseAdmin
      .from('friend_rooms')
      .select('*')
      .eq('room_id', roomCode)
      .single();

    if (fetchError || !friendRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is in the room
    if (!friendRoom.players[userId]) {
      return res.status(403).json({ error: 'User not in room' });
    }

    // Update mic state for this user
    const currentMicState = friendRoom.mic_state || {};
    const updatedMicState = {
      ...currentMicState,
      [userId]: {
        mic: micState !== undefined ? micState : (currentMicState[userId]?.mic || 'off'),
        speaking: speaking !== undefined ? speaking : (currentMicState[userId]?.speaking || false)
      }
    };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ mic_state: updatedMicState, updated_at: new Date().toISOString() })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`🎤 Mic state updated for ${userId} in room ${roomCode}:`, updatedMicState[userId]);
    res.json({ success: true, friendRoom: updatedRoom });
  } catch (error) {
    console.error('Error updating mic state:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
