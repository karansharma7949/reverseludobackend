import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';
import { assignColor, initializePositions } from '../utils/gameHelpers.js';

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
    const { noOfPlayers, dare } = req.body;

    if (!noOfPlayers || noOfPlayers < 2 || noOfPlayers > 6) {
      return res.status(400).json({ error: 'Invalid number of players (must be 2-6)' });
    }

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

    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
    const players = { [userId]: colors[0] };
    const positions = { [colors[0]]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 } };

    const { data: friendRoom, error } = await supabaseAdmin
      .from('friend_rooms')
      .insert({
        room_id: roomCode,
        host_id: userId,
        players: players,
        positions: positions,
        no_of_players: noOfPlayers,
        board_theme: 'classic',
        game_state: 'waiting',
        dice_state: 'waiting',
        pending_steps: {},
        winners: [],
        dare: dare || null,
      })
      .select()
      .single();

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

    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
    const usedColors = Object.values(friendRoom.players);
    const nextColor = colors.find(c => !usedColors.includes(c));

    const updatedPlayers = { ...friendRoom.players, [userId]: nextColor };
    const updatedPositions = {
      ...friendRoom.positions,
      [nextColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
    };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ players: updatedPlayers, positions: updatedPositions })
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

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ players: updatedPlayers, positions: updatedPositions })
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

// Start friend game
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

    if (Object.keys(friendRoom.players).length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    const playerIds = Object.keys(friendRoom.players);
    const randomIndex = Math.floor(Math.random() * playerIds.length);
    const firstTurn = playerIds[randomIndex];

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ game_state: 'playing', turn: firstTurn })
      .eq('room_id', roomCode)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ friendRoom: updatedRoom });
  } catch (error) {
    console.error('Error starting friend game:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
