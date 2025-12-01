import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';
import { positions4Player, positions5Player, positions6Player, starPositions, boardConfig } from './data/positions.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Supabase client with service role (for admin operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Supabase client with anon key (for JWT verification)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Position data is now imported from ./data/positions.js
// This ensures consistency between server.js and the modular backend

// Helper function to get board position for a token
// Each color now has complete path data (no sharedPath needed)
function getBoardPosition(color, index, noOfPlayers) {
  if (noOfPlayers <= 4) {
    // 4-player: return [row, col]
    const colorPositions = positions4Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'grid', pos: colorPositions[index] };
    }
  } else if (noOfPlayers === 5) {
    // 5-player: return [x, y] vector - each color has complete path
    const colorPositions = positions5Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'vector', pos: colorPositions[index] };
    }
  } else {
    // 6-player: return [x, y] vector - each color has complete path
    const colorPositions = positions6Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'vector', pos: colorPositions[index] };
    }
  }
  return null;
}

// Helper function to check if two positions are the same (for kill detection)
function arePositionsSame(pos1, pos2, noOfPlayers) {
  if (!pos1 || !pos2) {
    console.log(`arePositionsSame: pos1=${JSON.stringify(pos1)}, pos2=${JSON.stringify(pos2)} - returning false (null)`);
    return false;
  }
  
  if (noOfPlayers <= 4) {
    // 4-player: exact grid match
    return pos1.pos[0] === pos2.pos[0] && pos1.pos[1] === pos2.pos[1];
  } else {
    // 5/6-player: within ±30 range
    const dx = Math.abs(pos1.pos[0] - pos2.pos[0]);
    const dy = Math.abs(pos1.pos[1] - pos2.pos[1]);
    return dx <= 30 && dy <= 30;
  }
}

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token with Supabase
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Create or get user profile (protected)
app.post('/api/users/profile', authenticateUser, async (req, res) => {
  try {
    console.log("request reached")
    const { uid, username, email, avatarUrl } = req.body;

    // Verify the requesting user matches the profile being created
    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized: Cannot create profile for another user' });
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('uid', uid)
      .single();

    if (existingUser) {
      return res.json({ success: true, user: existingUser, isNew: false });
    }

    // Check if username is already taken
    const { data: existingUsername } = await supabaseAdmin
      .from('users')
      .select('username')
      .eq('username', username)
      .single();

    
    if (existingUsername) {
      return res.status(409).json({ 
        error: 'USERNAME_TAKEN',
        message: 'This username is already taken. Please try another one.' 
      });
    }

    // Create new user with default values
    const { data: newUser, error } = await supabaseAdmin
      .from('users')
      .insert({
        uid: uid,
        username: username,
        total_coins: 2500,
        total_diamonds: 150,
        talk_time_end_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        profile_image_url: avatarUrl || null,
      })
      .select()
      .single();

    if (error) {
      console.log('Database error:', error);
      
      // Check if it's a unique constraint violation (duplicate username)
      if (error.code === '23505' && error.message.includes('username')) {
        return res.status(409).json({ 
          error: 'USERNAME_TAKEN',
          message: 'This username is already taken. Please try another one.' 
        });
      }
      
      throw error;
    }

    res.json({ success: true, user: newUser, isNew: true });
  } catch (error) {
    console.error('Error creating user profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user profile (protected)
app.get('/api/users/:uid', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('uid', uid)
      .single();

    if (error) throw error;

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user coins (protected)
app.patch('/api/users/:uid/coins', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;
    const { amount } = req.body;

    // Verify the requesting user matches the profile being updated
    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized: Cannot update another user\'s coins' });
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ total_coins: amount })
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user diamonds (protected)
app.patch('/api/users/:uid/diamonds', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;
    const { amount } = req.body;

    // Verify the requesting user matches the profile being updated
    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized: Cannot update another user\'s diamonds' });
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ total_diamonds: amount })
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload profile image (protected)
app.post('/api/users/:uid/upload-avatar', authenticateUser, upload.single('avatar'), async (req, res) => {
  try {
    const { uid } = req.params;
    const file = req.file;

    // Verify the requesting user matches the profile being updated
    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized: Cannot upload avatar for another user' });
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload to Supabase Storage
    const fileName = `${uid}_${Date.now()}.${file.mimetype.split('/')[1]}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(fileName);

    // Update user profile
    const { data: user, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ profile_image_url: publicUrl })
      .eq('uid', uid)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, user, imageUrl: publicUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GAME ROOM ENDPOINTS
// ============================================

// Generate unique room ID
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Assign color to player based on number of existing players
function assignColor(players, noOfPlayers) {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const availableColors = colors.slice(0, noOfPlayers);
  const usedColors = Object.values(players);
  
  for (const color of availableColors) {
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  
  return null; // Room is full
}

// Initialize positions for active players only
function initializePositions(players) {
  const positions = {};
  
  // Only create positions for colors that are actually playing
  for (const color of Object.values(players)) {
    positions[color] = {
      tokenA: 0,
      tokenB: 0,
      tokenC: 0,
      tokenD: 0
    };
  }
  
  return positions;
}

// Quick match - Find available room or create new one
app.post('/api/game-rooms/quick-match', authenticateUser, async (req, res) => {
  try {
    const { noOfPlayers, boardTheme } = req.body;
    const userId = req.user.id;

    // Validate number of players
    if (![2, 3, 4, 5, 6].includes(noOfPlayers)) {
      return res.status(400).json({ error: 'Number of players must be 2, 3, 4, 5, or 6' });
    }

    // Find available rooms with space
    const { data: availableRooms, error: searchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('game_state', 'waiting')
      .eq('no_of_players', noOfPlayers)
      .order('created_at', { ascending: true });

    if (searchError) {
      console.error('Error searching for rooms:', searchError);
      throw searchError;
    }

    // Check each room for available space
    let roomToJoin = null;
    if (availableRooms && availableRooms.length > 0) {
      for (const room of availableRooms) {
        const currentPlayerCount = Object.keys(room.players).length;
        // Check if room has space and user is not already in it
        if (currentPlayerCount < room.no_of_players && !room.players[userId]) {
          roomToJoin = room;
          break;
        }
      }
    }

    // If found a room with space, join it
    if (roomToJoin) {
      const assignedColor = assignColor(roomToJoin.players, roomToJoin.no_of_players);
      if (!assignedColor) {
        return res.status(400).json({ error: 'No available colors' });
      }

      const updatedPlayers = { ...roomToJoin.players, [userId]: assignedColor };
      
      // Update positions to include new player's color
      const updatedPositions = {
        ...roomToJoin.positions,
        [assignedColor]: {
          tokenA: 0,
          tokenB: 0,
          tokenC: 0,
          tokenD: 0
        }
      };
      
      const { data: updatedRoom, error: updateError } = await supabaseAdmin
        .from('game_rooms')
        .update({ 
          players: updatedPlayers,
          positions: updatedPositions  // ← Add new player's positions
        })
        .eq('room_id', roomToJoin.room_id)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({ 
        success: true, 
        gameRoom: updatedRoom, 
        action: 'joined',
        message: 'Joined existing room'
      });
    }

    // No available room found, create a new one
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

      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique room ID' });
    }

    const colors = ['red', 'blue', 'green', 'yellow'];
    const hostColor = colors[0];
    
    // Initialize players and positions
    const players = { [userId]: hostColor };
    const positions = initializePositions(players);

    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_id: roomId,
        host_id: userId,
        players: players,
        positions: positions,  // ← Only host's color
        no_of_players: noOfPlayers,
        board_theme: boardTheme || 'classic',
        dice_state: 'waiting',
        dice_result: null,
        game_state: 'waiting',
        turn: null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating game room:', error);
      throw error;
    }

    res.json({ 
      success: true, 
      gameRoom,
      action: 'created',
      message: 'Created new room'
    });
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

    // Validate number of players
    if (![2, 3, 4, 5, 6].includes(noOfPlayers)) {
      return res.status(400).json({ error: 'Number of players must be 2, 3, 4, 5, or 6' });
    }

    // Generate unique room ID
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

      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique room ID' });
    }

    // Assign first color to host (red for 2+ players)
    const colors = ['red', 'blue', 'green', 'yellow'];
    const hostColor = colors[0]; // Host always gets first color
    
    // Initialize players object
    const players = { [hostId]: hostColor };
    
    // Initialize positions only for host's color
    const positions = initializePositions(players);

    // Create game room
    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .insert({
        room_id: roomId,
        host_id: hostId,
        players: players,
        positions: positions,  // ← Only host's color
        no_of_players: noOfPlayers,
        board_theme: boardTheme || 'classic',
        dice_state: 'waiting',
        dice_result: null,
        game_state: 'waiting',
        turn: null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating game room:', error);
      throw error;
    }

    res.json({ success: true, gameRoom });
  } catch (error) {
    console.error('Error creating game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join game room
app.post('/api/game-rooms/:roomId/join', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const playerId = req.user.id;

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Check if game already started
    if (gameRoom.game_state !== 'waiting') {
      return res.status(400).json({ error: 'Game has already started' });
    }

    // Check if player already in room
    if (gameRoom.players[playerId]) {
      return res.json({ success: true, gameRoom, message: 'Already in room' });
    }

    // Check if room is full
    const currentPlayerCount = Object.keys(gameRoom.players).length;
    if (currentPlayerCount >= gameRoom.no_of_players) {
      return res.status(400).json({ error: 'Game room is full' });
    }

    // Assign color to new player
    const assignedColor = assignColor(gameRoom.players, gameRoom.no_of_players);
    if (!assignedColor) {
      return res.status(400).json({ error: 'No available colors' });
    }

    // Add player to room with assigned color
    const updatedPlayers = { ...gameRoom.players, [playerId]: assignedColor };
    
    // Update positions to include new player's color
    const updatedPositions = {
      ...gameRoom.positions,
      [assignedColor]: {
        tokenA: 0,
        tokenB: 0,
        tokenC: 0,
        tokenD: 0
      }
    };
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ 
        players: updatedPlayers,
        positions: updatedPositions  // ← Add new player's positions
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error joining game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get game room details
app.get('/api/game-rooms/:roomId', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;

    const { data: gameRoom, error } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (error || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    res.json({ success: true, gameRoom });
  } catch (error) {
    console.error('Error fetching game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start game
app.post('/api/game-rooms/:roomId/start', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Only host can start game
    if (gameRoom.host_id !== userId) {
      return res.status(403).json({ error: 'Only host can start the game' });
    }

    // Check if enough players
    const playerIds = Object.keys(gameRoom.players);
    if (playerIds.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }

    // Start game - set random player's turn
    const randomIndex = Math.floor(Math.random() * playerIds.length);
    const randomPlayerId = playerIds[randomIndex];
    
    console.log('Starting game with random player:', randomPlayerId);
    
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({
        game_state: 'playing',
        turn: randomPlayerId,
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: error.message });
  }
});

// Roll dice
app.post('/api/game-rooms/:roomId/roll-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    console.log('=== Roll Dice Request ===');
    console.log('Room ID:', roomId);
    console.log('User ID:', userId);

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      console.log('Game room not found:', fetchError);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log('Current turn:', gameRoom.turn);
    console.log('Players:', Object.keys(gameRoom.players));
    console.log('Game state:', gameRoom.game_state);

    // Check if it's player's turn
    if (gameRoom.turn !== userId) {
      console.log('Not player turn');
      return res.status(403).json({ error: 'Not your turn' });
    }

    // Check if game is playing
    if (gameRoom.game_state !== 'playing') {
      console.log('Game not playing');
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    // Check if user has pending steps (must move token first)
    const pendingSteps = gameRoom.pending_steps || {};
    if (pendingSteps[userId] && pendingSteps[userId] > 0) {
      console.log('User has pending steps:', pendingSteps[userId]);
      return res.status(400).json({ 
        error: 'You must move a token first',
        pendingSteps: pendingSteps[userId]
      });
    }

    // Generate random dice result (1-6)
    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log('Generated dice result:', diceResult);

    // RULE 3: Track consecutive 6s
    const consecutiveSixes = gameRoom.consecutive_sixes || {};
    let currentCount = consecutiveSixes[userId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    // If 3 consecutive 6s, cancel turn
    if (currentCount >= 3) {
      console.log('3 consecutive 6s! Turn cancelled');
      
      // Reset consecutive 6s and pass turn
      const updatedConsecutiveSixes = { ...consecutiveSixes };
      updatedConsecutiveSixes[userId] = 0;
      
      const playerIds = Object.keys(gameRoom.players);
      const currentPlayerIndex = playerIds.indexOf(userId);
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      const nextTurn = playerIds[nextPlayerIndex];
      
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

      return res.json({ 
        success: true, 
        turnCancelled: true, 
        message: '3 consecutive 6s! Turn cancelled',
        gameRoom: updatedRoom 
      });
    }

    // Update consecutive 6s count
    const updatedConsecutiveSixes = { ...consecutiveSixes };
    updatedConsecutiveSixes[userId] = currentCount;

    // Update game room with dice result and rolling state
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

    if (updateError) {
      console.log('Update error:', updateError);
      throw updateError;
    }

    console.log('Dice rolled successfully');
    res.json({ success: true, diceResult, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error rolling dice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Complete dice roll (after animation)
app.post('/api/game-rooms/:roomId/complete-dice', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // If dice_state is already 'waiting', the turn was already passed (no valid moves case)
    // Just return success without doing anything
    if (gameRoom.dice_state === 'waiting') {
      console.log('Dice already completed (turn was passed due to no valid moves)');
      return res.json({ success: true, alreadyCompleted: true, gameRoom });
    }

    // Check if it's player's turn
    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    const diceResult = gameRoom.dice_result || 0;
    const playerColor = gameRoom.players[userId];
    const positions = gameRoom.positions || {};
    const playerPositions = positions[playerColor] || {};

    // Check if player has any valid moves
    let hasValidMove = false;

    // Check each token
    for (const tokenName in playerPositions) {
      const currentPos = playerPositions[tokenName];
      
      // RULE 1: Token at home (position 0) can only exit with a 6
      if (currentPos === 0) {
        if (diceResult === 6) {
          hasValidMove = true;
          break;
        }
      } else {
        // Token is on the board - can move if not at final position
        if (currentPos < 57) {
          // Check if move would exceed 57 (must land exactly on 57)
          if (currentPos + diceResult <= 57) {
            hasValidMove = true;
            break;
          }
        }
      }
    }

    console.log(`Player ${playerColor} rolled ${diceResult}, has valid move: ${hasValidMove}`);

    // If no valid moves, pass turn to next player
    if (!hasValidMove) {
      console.log('No valid moves available, passing turn');
      
      const playerIds = Object.keys(gameRoom.players);
      const currentPlayerIndex = playerIds.indexOf(userId);
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      const nextTurn = playerIds[nextPlayerIndex];

      // Reset consecutive 6s if not rolling a 6
      const consecutiveSixes = gameRoom.consecutive_sixes || {};
      if (diceResult !== 6) {
        consecutiveSixes[userId] = 0;
      }

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

      return res.json({ 
        success: true, 
        noValidMoves: true, 
        message: 'No valid moves available, turn passed',
        gameRoom: updatedRoom 
      });
    }

    // Player has valid moves, add to pending_steps
    const pendingSteps = gameRoom.pending_steps || {};
    pendingSteps[userId] = diceResult;

    // Update dice state to complete and set pending_steps
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
      })
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error completing dice roll:', error);
    res.status(500).json({ error: error.message });
  }
});

// Move token (after dice roll)
app.post('/api/game-rooms/:roomId/move-token', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const { tokenName, color } = req.body;

    console.log('=== Move Token Request ===');
    console.log('Room ID:', roomId);
    console.log('User ID:', userId);
    console.log('Token Name:', tokenName);
    console.log('Color:', color);

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Check if it's player's turn
    if (gameRoom.turn !== userId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    // Check if user has pending steps
    const pendingSteps = gameRoom.pending_steps || {};
    const stepsToMove = pendingSteps[userId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    // Verify the color belongs to this user
    if (gameRoom.players[userId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to you' });
    }

    // Get current position of the token
    const currentPosition = gameRoom.positions[color]?.[tokenName];
    if (currentPosition === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    // RULE 1: Must roll 6 to move out of home
    if (currentPosition === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }

    // Calculate new position
    let newPosition = currentPosition === 0 ? 1 : currentPosition + stepsToMove;

    // RULE 5: Home column (57-61) - need exact dice count
    if (currentPosition >= 57 && currentPosition < 61) {
      if (newPosition > 61) {
        return res.status(400).json({ error: 'Need exact dice count to enter home' });
      }
    }
    // Check if moving into home column
    if (currentPosition < 57 && newPosition > 56) {
      if (newPosition > 61) {
        return res.status(400).json({ error: 'Need exact dice count to enter home' });
      }
    }

    // Update positions
    let updatedPositions = {
      ...gameRoom.positions,
      [color]: {
        ...gameRoom.positions[color],
        [tokenName]: newPosition
      }
    };

    // RULE 4: Check for kills (landing on opponent's token)
    // Star positions (safe spots) where tokens cannot be killed - based on board type
    const starPositions4Player = [9, 17, 22, 30, 35, 43, 48, 56];
    const starPositions5Player = [9, 17, 22, 30, 35, 43, 48, 56, 61, 69];
    const starPositions6Player = [9, 17, 22, 30, 35, 43, 48, 56, 61, 69, 74, 82];
    
    // Determine which star positions to use based on number of players
    const noOfPlayers = gameRoom.no_of_players || 4;
    let starPositions;
    if (noOfPlayers <= 4) {
      starPositions = starPositions4Player;
    } else if (noOfPlayers === 5) {
      starPositions = starPositions5Player;
    } else {
      starPositions = starPositions6Player;
    }
    
    // Check if new position is a safe spot (star position)
    const isOnSafeSpot = starPositions.includes(newPosition);
    
    let bonusRoll = false;
    
    // Get the final position limit based on board type (home column starts here)
    const finalPosition = noOfPlayers <= 4 ? 57 : (noOfPlayers === 5 ? 69 : 83);
    
    console.log(`Kill check: ${color} moving to position ${newPosition}, isOnSafeSpot: ${isOnSafeSpot}, finalPosition: ${finalPosition}`);
    
    // Only check for kills if NOT on a safe spot and not in home column
    if (!isOnSafeSpot && newPosition > 0 && newPosition < finalPosition) {
      // Get the board position of the moving token
      const movingTokenBoardPos = getBoardPosition(color, newPosition, noOfPlayers);
      console.log(`Moving token board pos:`, movingTokenBoardPos);
      
      for (const [opponentColor, tokens] of Object.entries(gameRoom.positions)) {
        if (opponentColor === color) continue; // Skip own tokens
        
        for (const [opponentToken, opponentPos] of Object.entries(tokens)) {
          // Skip tokens at home or in home column
          if (opponentPos <= 0 || opponentPos >= finalPosition) continue;
          
          // Get the board position of the opponent token
          const opponentBoardPos = getBoardPosition(opponentColor, opponentPos, noOfPlayers);
          console.log(`Checking ${opponentColor} ${opponentToken} at pos ${opponentPos}:`, opponentBoardPos);
          
          // Check if positions match based on board type
          const positionsMatch = arePositionsSame(movingTokenBoardPos, opponentBoardPos, noOfPlayers);
          console.log(`Positions match: ${positionsMatch}`);
          
          if (positionsMatch) {
            // Kill! Send opponent back to home
            updatedPositions[opponentColor][opponentToken] = 0;
            bonusRoll = true;
            console.log(`🎯 ${color} killed ${opponentColor}'s ${opponentToken}!`);
          }
        }
      }
    }

    // Check if all tokens reached home based on board type
    const homePosition = noOfPlayers <= 4 ? 61 : (noOfPlayers === 5 ? 73 : 86);
    const allTokensHome = Object.values(updatedPositions[color]).every(pos => pos === homePosition);
    let updatedWinners = [...(gameRoom.winners || [])];
    
    if (allTokensHome && !updatedWinners.includes(userId)) {
      updatedWinners.push(userId);
      console.log(`🏆 Player ${userId} finished! Position: ${updatedWinners.length}`);
    }

    // Clear pending steps for this user
    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[userId];

    // Determine next turn
    const playerIds = Object.keys(gameRoom.players);
    const currentPlayerIndex = playerIds.indexOf(userId);
    
    // RULE 2 & 4: Get another turn if rolled 6 or killed opponent
    let nextTurn = userId;
    if (stepsToMove !== 6 && !bonusRoll) {
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      nextTurn = playerIds[nextPlayerIndex];
    }

    // Check if game is finished (all but one player finished)
    const gameFinished = updatedWinners.length >= playerIds.length - 1;

    // Update game room
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

    if (updateError) {
      console.log('Update error:', updateError);
      throw updateError;
    }

    console.log('Token moved successfully');
    res.json({ success: true, gameRoom: updatedRoom, bonusRoll, killed: bonusRoll });
  } catch (error) {
    console.error('Error moving token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update game state (dice roll, token move, etc.)
app.patch('/api/game-rooms/:roomId/update', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Check if user is in the game
    if (!gameRoom.players[userId]) {
      return res.status(403).json({ error: 'You are not in this game' });
    }

    // Update game room
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update(updates)
      .eq('room_id', roomId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ success: true, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error updating game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Leave game room
app.post('/api/game-rooms/:roomId/leave', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // If host leaves, delete the room
    if (gameRoom.host_id === userId) {
      const { error: deleteError } = await supabaseAdmin
        .from('game_rooms')
        .delete()
        .eq('room_id', roomId);

      if (deleteError) throw deleteError;

      return res.json({ success: true, message: 'Game room deleted' });
    }

    // Remove player from room
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
    console.error('Error leaving game room:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// FRIEND ROOM ENDPOINTS
// ============================================

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
app.post('/api/friend-rooms/create', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { noOfPlayers } = req.body;

    if (!noOfPlayers || noOfPlayers < 4 || noOfPlayers > 6) {
      return res.status(400).json({ error: 'Invalid number of players (must be 4, 5, or 6)' });
    }

    // Generate unique room code
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

    // Assign first color to host
    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
    const players = { [userId]: colors[0] };

    // Initialize positions for host's color only
    const positions = {
      [colors[0]]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
    };

    // Create friend room (same structure as game_rooms)
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
app.post('/api/friend-rooms/:roomCode/join', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomCode } = req.params;

    // Get friend room
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
      return res.json({ friendRoom }); // Already in room
    }

    if (Object.keys(friendRoom.players).length >= friendRoom.no_of_players) {
      return res.status(400).json({ error: 'Room is full' });
    }

    // Assign next available color
    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
    const usedColors = Object.values(friendRoom.players);
    const nextColor = colors.find(c => !usedColors.includes(c));

    // Add player to room
    const updatedPlayers = { ...friendRoom.players, [userId]: nextColor };

    // Add positions for new player's color
    const updatedPositions = {
      ...friendRoom.positions,
      [nextColor]: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
    };

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ 
        players: updatedPlayers,
        positions: updatedPositions
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
app.get('/api/friend-rooms/:roomCode', authenticateUser, async (req, res) => {
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

// ============================================
// BOT ENDPOINTS (No authentication required)
// ============================================

// Bot Roll Dice (Bot sends its own user ID)
app.post('/api/game-rooms/:roomId/bot-roll-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    console.log('=== Bot Roll Dice Request ===');
    console.log('Room ID:', roomId);
    console.log('Bot User ID:', botUserId);

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      console.log('Game room not found:', fetchError);
      return res.status(404).json({ error: 'Game room not found' });
    }

    console.log('Current turn:', gameRoom.turn);
    console.log('Game state:', gameRoom.game_state);

    // Check if it's bot's turn
    if (gameRoom.turn !== botUserId) {
      console.log('Not bot turn');
      return res.status(403).json({ error: 'Not bot turn' });
    }

    // Check if game is playing
    if (gameRoom.game_state !== 'playing') {
      console.log('Game not playing');
      return res.status(400).json({ error: 'Game is not in playing state' });
    }

    // Check if bot has pending steps (must move token first)
    const pendingSteps = gameRoom.pending_steps || {};
    if (pendingSteps[botUserId] && pendingSteps[botUserId] > 0) {
      console.log('Bot has pending steps:', pendingSteps[botUserId]);
      return res.status(400).json({ 
        error: 'Bot must move a token first',
        pendingSteps: pendingSteps[botUserId]
      });
    }

    // Generate random dice result (1-6)
    const diceResult = Math.floor(Math.random() * 6) + 1;
    console.log('Generated dice result:', diceResult);

    // RULE 3: Track consecutive 6s
    const consecutiveSixes = gameRoom.consecutive_sixes || {};
    let currentCount = consecutiveSixes[botUserId] || 0;
    
    if (diceResult === 6) {
      currentCount += 1;
    } else {
      currentCount = 0;
    }

    // If 3 consecutive 6s, cancel turn
    if (currentCount >= 3) {
      console.log('3 consecutive 6s! Turn cancelled');
      
      // Reset consecutive 6s and pass turn
      const updatedConsecutiveSixes = { ...consecutiveSixes };
      updatedConsecutiveSixes[botUserId] = 0;
      
      const playerIds = Object.keys(gameRoom.players);
      const currentPlayerIndex = playerIds.indexOf(botUserId);
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      const nextTurn = playerIds[nextPlayerIndex];
      
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

      return res.json({ 
        success: true, 
        turnCancelled: true, 
        message: '3 consecutive 6s! Turn cancelled',
        gameRoom: updatedRoom 
      });
    }

    // Update consecutive 6s count
    const updatedConsecutiveSixes = { ...consecutiveSixes };
    updatedConsecutiveSixes[botUserId] = currentCount;

    // Update game room with dice result and rolling state
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

    if (updateError) {
      console.log('Update error:', updateError);
      throw updateError;
    }

    console.log('Dice rolled successfully');
    res.json({ success: true, diceResult, gameRoom: updatedRoom });
  } catch (error) {
    console.error('Error rolling dice for bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bot Complete Dice (Bot sends its own user ID)
app.post('/api/game-rooms/:roomId/bot-complete-dice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Check if it's bot's turn
    if (gameRoom.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    const diceResult = gameRoom.dice_result || 0;
    const playerColor = gameRoom.players[botUserId];
    const positions = gameRoom.positions || {};
    const playerPositions = positions[playerColor] || {};

    // Check if bot has any valid moves
    let hasValidMove = false;

    // Check each token
    for (const tokenName in playerPositions) {
      const currentPos = playerPositions[tokenName];
      
      // RULE 1: Token at home (position 0) can only exit with a 6
      if (currentPos === 0) {
        if (diceResult === 6) {
          hasValidMove = true;
          break;
        }
      } else {
        // Token is on the board - can move if not at final position
        if (currentPos < 57) {
          // Check if move would exceed 57 (must land exactly on 57)
          if (currentPos + diceResult <= 57) {
            hasValidMove = true;
            break;
          }
        }
      }
    }

    console.log(`Bot ${playerColor} rolled ${diceResult}, has valid move: ${hasValidMove}`);

    // If no valid moves, pass turn to next player
    if (!hasValidMove) {
      console.log('No valid moves available, passing turn');
      
      const playerIds = Object.keys(gameRoom.players);
      const currentPlayerIndex = playerIds.indexOf(botUserId);
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      const nextTurn = playerIds[nextPlayerIndex];

      // Reset consecutive 6s if not rolling a 6
      const consecutiveSixes = gameRoom.consecutive_sixes || {};
      if (diceResult !== 6) {
        consecutiveSixes[botUserId] = 0;
      }

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

      return res.json({ 
        success: true, 
        noValidMoves: true, 
        message: 'No valid moves available, turn passed',
        gameRoom: updatedRoom 
      });
    }

    // Bot has valid moves, add to pending_steps
    const pendingSteps = gameRoom.pending_steps || {};
    pendingSteps[botUserId] = diceResult;

    // Update dice state to complete and set pending_steps
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({
        dice_state: 'complete',
        pending_steps: pendingSteps,
      })
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

// Bot Move Token (Bot sends its own user ID)
app.post('/api/game-rooms/:roomId/bot-move-token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { botUserId, tokenName, color } = req.body;

    if (!botUserId) {
      return res.status(400).json({ error: 'botUserId is required' });
    }

    console.log('=== Bot Move Token Request ===');
    console.log('Room ID:', roomId);
    console.log('Bot User ID:', botUserId);
    console.log('Token Name:', tokenName);
    console.log('Color:', color);

    // Get game room
    const { data: gameRoom, error: fetchError } = await supabaseAdmin
      .from('game_rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (fetchError || !gameRoom) {
      return res.status(404).json({ error: 'Game room not found' });
    }

    // Check if it's bot's turn
    if (gameRoom.turn !== botUserId) {
      return res.status(403).json({ error: 'Not bot turn' });
    }

    // Check if bot has pending steps
    const pendingSteps = gameRoom.pending_steps || {};
    const stepsToMove = pendingSteps[botUserId];
    
    if (!stepsToMove || stepsToMove <= 0) {
      return res.status(400).json({ error: 'No pending steps to move' });
    }

    // Verify the color belongs to this bot
    if (gameRoom.players[botUserId] !== color) {
      return res.status(403).json({ error: 'This color does not belong to this bot' });
    }

    // Get current position of the token
    const currentPosition = gameRoom.positions[color]?.[tokenName];
    if (currentPosition === undefined) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    // RULE 1: Must roll 6 to move out of home
    if (currentPosition === 0 && stepsToMove !== 6) {
      return res.status(400).json({ error: 'Must roll 6 to move token out of home' });
    }

    // Calculate new position
    let newPosition = currentPosition === 0 ? 1 : currentPosition + stepsToMove;

    // RULE 5: Home column (57-61) - need exact dice count
    if (currentPosition >= 57 && currentPosition < 61) {
      if (newPosition > 61) {
        return res.status(400).json({ error: 'Need exact dice count to enter home' });
      }
    }
    // Check if moving into home column
    if (currentPosition < 57 && newPosition > 56) {
      if (newPosition > 61) {
        return res.status(400).json({ error: 'Need exact dice count to enter home' });
      }
    }

    // Update positions
    let updatedPositions = {
      ...gameRoom.positions,
      [color]: {
        ...gameRoom.positions[color],
        [tokenName]: newPosition
      }
    };

    console.log("update position ...............>>.", updatedPositions ); 

    // RULE 4: Check for kills (landing on opponent's token)
    // Star positions (safe spots) where tokens cannot be killed
    const starPositions4Player = [9, 17, 22, 30, 35, 43, 48, 56];
    const starPositions5Player = [9, 17, 22, 30, 35, 43, 48, 56, 61, 69];
    const starPositions6Player = [9, 17, 22, 30, 35, 43, 48, 56, 61, 69, 74, 82];
    
    // Determine which star positions to use based on number of players
    const noOfPlayers = gameRoom.no_of_players || 4;
    let starPositions;
    if (noOfPlayers <= 4) {
      starPositions = starPositions4Player;
    } else if (noOfPlayers === 5) {
      starPositions = starPositions5Player;
    } else {
      starPositions = starPositions6Player;
    }
    
    // Check if new position is a safe spot (star position)
    const isOnSafeSpot = starPositions.includes(newPosition);
    
    let bonusRoll = false;
    
    // Get the final position limit based on board type
    const finalPosition = noOfPlayers <= 4 ? 57 : (noOfPlayers === 5 ? 69 : 83);
    
    // Only check for kills if NOT on a safe spot and not in home column
    if (!isOnSafeSpot && newPosition > 0 && newPosition < finalPosition) {
      // Get the board position of the moving token
      const movingTokenBoardPos = getBoardPosition(color, newPosition, noOfPlayers);
      
      for (const [opponentColor, tokens] of Object.entries(gameRoom.positions)) {
        if (opponentColor === color) continue; // Skip own tokens
        
        for (const [opponentToken, opponentPos] of Object.entries(tokens)) {
          // Skip tokens at home or in home column
          if (opponentPos <= 0 || opponentPos >= finalPosition) continue;
          
          // Get the board position of the opponent token
          const opponentBoardPos = getBoardPosition(opponentColor, opponentPos, noOfPlayers);
          
          // Check if positions match based on board type
          if (arePositionsSame(movingTokenBoardPos, opponentBoardPos, noOfPlayers)) {
            // Kill! Send opponent back to home
            updatedPositions[opponentColor][opponentToken] = 0;
            bonusRoll = true;
            console.log(`Bot ${color} killed ${opponentColor}'s ${opponentToken}! (Position match)`);
          }
        }
      }
    }

    // Check if all tokens reached home based on board type
    const homePosition = noOfPlayers <= 4 ? 61 : (noOfPlayers === 5 ? 73 : 86);
    const allTokensHome = Object.values(updatedPositions[color]).every(pos => pos === homePosition);
    let updatedWinners = [...(gameRoom.winners || [])];
    
    if (allTokensHome && !updatedWinners.includes(botUserId)) {
      updatedWinners.push(botUserId);
      console.log(`🏆 Bot ${botUserId} finished! Position: ${updatedWinners.length}`);
    }

    // Clear pending steps for this bot
    const updatedPendingSteps = { ...pendingSteps };
    delete updatedPendingSteps[botUserId];

    // Determine next turn
    const playerIds = Object.keys(gameRoom.players);
    const currentPlayerIndex = playerIds.indexOf(botUserId);
    
    // RULE 2 & 4: Get another turn if rolled 6 or killed opponent
    let nextTurn = botUserId;
    if (stepsToMove !== 6 && !bonusRoll) {
      const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
      nextTurn = playerIds[nextPlayerIndex];
    }

    // Check if game is finished (all but one player finished)
    const gameFinished = updatedWinners.length >= playerIds.length - 1;

    // Update game room
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

    if (updateError) {
      console.log('Update error:', updateError);
      throw updateError;
    }

    console.log('Bot token moved successfully');
    res.json({ success: true, gameRoom: updatedRoom, bonusRoll, killed: bonusRoll });
  } catch (error) {
    console.error('Error moving token for bot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Leave friend room
app.post('/api/friend-rooms/:roomCode/leave', authenticateUser, async (req, res) => {
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

    // If host leaves, delete the room
    if (friendRoom.host_id === userId) {
      const { error: deleteError } = await supabaseAdmin
        .from('friend_rooms')
        .delete()
        .eq('room_id', roomCode);

      if (deleteError) throw deleteError;

      return res.json({ success: true, message: 'Room deleted' });
    }

    // Get player's color before removing
    const playerColor = friendRoom.players[userId];

    // Remove player from room
    const updatedPlayers = { ...friendRoom.players };
    delete updatedPlayers[userId];

    // Remove player's positions
    const updatedPositions = { ...friendRoom.positions };
    delete updatedPositions[playerColor];

    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ 
        players: updatedPlayers,
        positions: updatedPositions
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

// Start friend game
app.post('/api/friend-rooms/:roomCode/start', authenticateUser, async (req, res) => {
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

    // Update friend room to 'playing' state
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from('friend_rooms')
      .update({ game_state: 'playing' })
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Listen on all network interfaces (0.0.0.0) to accept connections from any device
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://192.168.29.34:${PORT}`);
  console.log(`\nBackend is accessible from any device on your network!`);
});


// Add bots to game room (silently, appearing as real players)
app.post('/api/game-rooms/:roomId/add-bots', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { numberOfBots } = req.body;

    if (!numberOfBots || numberOfBots < 1) {
      return res.status(400).json({ error: 'Invalid number of bots' });
    }

    // Get current room
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

    // Realistic bot names to mimic real players
    const botNames = [
      'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley',
      'Sam', 'Jamie', 'Chris', 'Pat', 'Drew', 'Quinn',
      'Avery', 'Blake', 'Cameron', 'Dakota', 'Emerson', 'Finley',
      'Harper', 'Hayden', 'Jesse', 'Kai', 'Logan', 'Micah',
      'Noah', 'Parker', 'Reese', 'Rowan', 'Sage', 'Skylar'
    ];

    // Add bots with realistic IDs and create fake user entries
    const updatedPlayers = { ...currentPlayers };
    const botUserEntries = [];

    for (let i = 0; i < botsToAdd; i++) {
      if (freeColors.length === 0) break;
      
      // Generate proper UUID v4 for bot
      const botId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      const botColor = freeColors.shift();
      const botName = botNames[Math.floor(Math.random() * botNames.length)] + Math.floor(Math.random() * 999);
      
      updatedPlayers[botId] = botColor;
      
      // Create fake user entry in users table (so bot appears as real player)
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
        console.error('Error creating bot users:', insertError);
        // Continue anyway, bots will just show as "Player X"
      }
    }

    // Initialize positions for bot colors
    const currentPositions = room.positions || {};
    const updatedPositions = { ...currentPositions };
    
    // Add position data for each bot color
    for (const [botId, botColor] of Object.entries(updatedPlayers)) {
      if (!currentPlayers[botId] && !updatedPositions[botColor]) {
        // This is a new bot, initialize its positions
        updatedPositions[botColor] = {
          tokenA: 0,
          tokenB: 0,
          tokenC: 0,
          tokenD: 0
        };
      }
    }

    // Update room with bots and their positions
    const { error: updateError } = await supabaseAdmin
      .from('game_rooms')
      .update({ 
        players: updatedPlayers,
        positions: updatedPositions
      })
      .eq('room_id', roomId);

    if (updateError) {
      console.error('Error adding bots:', updateError);
      return res.status(500).json({ error: 'Failed to add bots' });
    }

    res.json({ success: true, botsAdded: botsToAdd });
  } catch (error) {
    console.error('Error in add-bots endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
