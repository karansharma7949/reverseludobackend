import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';

import { recordMatchResult, recordTournamentWon } from '../services/userStatsService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const now = new Date().toISOString();

    let query = supabaseAdmin
      .from('tournament')
      .select('*')
      .not('tournament_start_time', 'is', null)
      .not('tournament_main_banner', 'is', null);

    if (status === 'upcoming') {
      query = query
        .gt('tournament_start_time', now)
        .order('tournament_start_time', { ascending: true });
    } else if (status === 'started') {
      query = query
        .lte('tournament_start_time', now)
        .order('tournament_start_time', { ascending: false });
    } else {
      query = query.order('tournament_start_time', { ascending: false });
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ tournaments: data || [] });
  } catch (error) {
    console.error('Error listing tournaments:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Join a tournament
router.post('/join', async (req, res) => {
  try {
    const { tournamentId, userId } = req.body;

    if (!tournamentId || !userId) {
      return res.status(400).json({ error: 'tournamentId and userId are required' });
    }

    // Get tournament details
    const { data: tournament, error: tournamentError } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('tournament_id', tournamentId)
      .single();

    if (tournamentError || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if tournament is full
    if (tournament.current_players >= tournament.max_players) {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    // Check if user already joined
    const participants = tournament.tournament_participants || {};
    if (participants[userId]) {
      return res.status(400).json({ error: 'Already joined this tournament' });
    }

    // Get user's coins
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('total_coins')
      .eq('uid', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    const entryFee = tournament.entry_fee || 0;
    if (userData.total_coins < entryFee) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }

    // Deduct entry fee
    const { error: deductError } = await supabaseAdmin
      .from('users')
      .update({ total_coins: userData.total_coins - entryFee })
      .eq('uid', userId);

    if (deductError) {
      return res.status(500).json({ error: 'Failed to deduct entry fee' });
    }

    // Add user to tournament_participants JSONB
    const newParticipant = {
      joined_at: new Date().toISOString(),
      entry_fee_paid: entryFee,
      status: 'waiting',
      semifinal_room_id: null,
      final_position: null,
      is_bot: false
    };

    const updatedParticipants = { ...participants, [userId]: newParticipant };
    const registeredPlayers = tournament.registered_players || [];
    registeredPlayers.push(userId);

    const { error: updateError } = await supabaseAdmin
      .from('tournaments')
      .update({
        tournament_participants: updatedParticipants,
        registered_players: registeredPlayers,
        current_players: tournament.current_players + 1
      })
      .eq('tournament_id', tournamentId);

    if (updateError) {
      // Refund on error
      await supabaseAdmin
        .from('users')
        .update({ total_coins: userData.total_coins })
        .eq('uid', userId);
      return res.status(500).json({ error: 'Failed to join tournament' });
    }

    res.json({ success: true, message: 'Joined tournament successfully' });
  } catch (error) {
    console.error('Error joining tournament:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start tournament (create semifinal rooms)
router.post('/start', async (req, res) => {
  try {
    const { tournamentId } = req.body;

    if (!tournamentId) {
      return res.status(400).json({ error: 'tournamentId is required' });
    }

    // Get tournament
    const { data: tournament, error: tournamentError } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('tournament_id', tournamentId)
      .single();

    if (tournamentError || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const participants = tournament.tournament_participants || {};
    const playerIds = Object.keys(participants).filter(id => !participants[id].is_bot);
    const playerCount = playerIds.length;

    // Check minimum players - don't cancel, just return error
    // Tournament will only end/complete based on its end_date
    if (playerCount < 4) {
      return res.json({ 
        success: false, 
        message: 'Not enough players to start. Need at least 4 players.',
        currentPlayers: playerCount,
        minRequired: 4
      });
    }

    // Fill with bots if needed
    let updatedParticipants = { ...participants };
    if (playerCount < 8) {
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
      ];

      const botsNeeded = 8 - playerCount;
      for (let i = 0; i < botsNeeded; i++) {
        const botId = fixedBotIds[i % fixedBotIds.length];
        updatedParticipants[botId] = {
          joined_at: new Date().toISOString(),
          entry_fee_paid: 0,
          status: 'waiting',
          semifinal_room_id: null,
          final_position: null,
          is_bot: true
        };
      }
    }

    // Shuffle all participants for random matchups
    const allPlayerIds = Object.keys(updatedParticipants);
    const shuffled = shuffleArray([...allPlayerIds]);

    // Create 4 semifinal rooms
    const semifinalRooms = [];
    for (let roomNum = 1; roomNum <= 4; roomNum++) {
      const player1 = shuffled[(roomNum - 1) * 2];
      const player2 = shuffled[(roomNum - 1) * 2 + 1];

      const roomId = `tournament_${tournamentId}_semifinal_${roomNum}`;
      
      const { data: room, error: roomError } = await supabaseAdmin
        .from('tournament_rooms')
        .insert({
          room_id: roomId,
          host_id: player1,
          no_of_players: 2,
          board_theme: 'classic',
          dice_state: 'waiting',
          game_state: 'waiting',
          room_level: 'semifinal',
          tournament_id: tournamentId,
          positions: {
            red: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 },
            blue: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
          },
          players: {
            [player1]: 'red',
            [player2]: 'blue'
          },
          pending_steps: { [player1]: 0, [player2]: 0 },
          consecutive_sixes: { [player1]: 0, [player2]: 0 },
          turn: player1
        })
        .select()
        .single();

      if (roomError) {
        console.error('Error creating room:', roomError);
        continue;
      }

      // Update participants with room assignment
      updatedParticipants[player1].semifinal_room_id = room.id;
      updatedParticipants[player1].status = 'semifinal';
      updatedParticipants[player2].semifinal_room_id = room.id;
      updatedParticipants[player2].status = 'semifinal';

      semifinalRooms.push({
        roomNum,
        roomId: room.id,
        players: [player1, player2]
      });
    }

    // Update tournament
    await supabaseAdmin
      .from('tournaments')
      .update({ 
        status: 'in_progress',
        tournament_participants: updatedParticipants
      })
      .eq('tournament_id', tournamentId);

    res.json({ success: true, message: 'Tournament started', semifinalRooms });
  } catch (error) {
    console.error('Error starting tournament:', error);
    res.status(500).json({ error: error.message });
  }
});

// Record semifinal winner (called when a semifinal game ends)
router.post('/semifinal-complete', async (req, res) => {
  try {
    const { roomId, winnerId, loserId, tournamentId } = req.body;

    // Update the room with winner
    const { data: roomLock, error: roomUpdateError } = await supabaseAdmin
      .from('tournament_rooms')
      .update({ 
        game_state: 'finished', 
        winners: [winnerId] 
      })
      .eq('id', roomId)
      .neq('game_state', 'finished')
      .select('id')
      .maybeSingle();

    if (roomUpdateError) {
      console.error('Error updating room winner:', roomUpdateError);
      return res.status(500).json({ error: 'Failed to update room winner' });
    }

    if (roomLock) {
      try {
        await recordMatchResult({
          winnerUserIds: winnerId ? [winnerId] : [],
          loserUserIds: loserId ? [loserId] : [],
        });
      } catch (e) {
        console.error(
          '[UserStats] recordMatchResult failed (tournament semifinal):',
          e?.message ?? e,
        );
      }
    }

    // Update participant statuses in tournament
    const { data: tournament } = await supabaseAdmin
      .from('tournaments')
      .select('tournament_participants')
      .eq('tournament_id', tournamentId)
      .single();

    if (tournament) {
      const participants = tournament.tournament_participants || {};
      if (participants[winnerId]) {
        participants[winnerId].status = 'finalist';
      }
      if (loserId && participants[loserId]) {
        participants[loserId].status = 'eliminated';
      }

      await supabaseAdmin
        .from('tournaments')
        .update({ tournament_participants: participants })
        .eq('tournament_id', tournamentId);
    }

    // Check if all 4 semifinal rooms have winners
    const { data: semifinalRooms } = await supabaseAdmin
      .from('tournament_rooms')
      .select('id, winners')
      .eq('tournament_id', tournamentId)
      .eq('room_level', 'semifinal');

    // Count rooms that have a winner set
    const roomsWithWinners = semifinalRooms?.filter(room => 
      room.winners && room.winners.length > 0
    ) || [];

    if (roomsWithWinners.length === 4) {
      // All 4 semifinals complete - create final rooms (2 rooms with 2 players each)
      const finalists = roomsWithWinners.map(r => r.winners[0]);
      await createFinalRooms(tournamentId, finalists);
      
      res.json({ 
        success: true, 
        finalsReady: true, 
        finalists,
        message: 'All semifinals complete, final rooms created'
      });
    } else {
      res.json({ 
        success: true, 
        finalsReady: false, 
        completedSemifinals: roomsWithWinners.length,
        remaining: 4 - roomsWithWinners.length
      });
    }
  } catch (error) {
    console.error('Error completing semifinal:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create 2 final rooms (each with 2 finalists)
async function createFinalRooms(tournamentId, finalists) {
  // finalists = [winner1, winner2, winner3, winner4] from 4 semifinal rooms
  // Create 2 final rooms: Room 1 (winner1 vs winner2), Room 2 (winner3 vs winner4)
  
  const finalRooms = [
    { players: [finalists[0], finalists[1]], roomNum: 1 },
    { players: [finalists[2], finalists[3]], roomNum: 2 }
  ];

  for (const finalRoom of finalRooms) {
    const roomId = `tournament_${tournamentId}_final_${finalRoom.roomNum}`;
    const [player1, player2] = finalRoom.players;

    await supabaseAdmin
      .from('tournament_rooms')
      .insert({
        room_id: roomId,
        host_id: player1,
        no_of_players: 2,
        board_theme: 'classic',
        dice_state: 'waiting',
        game_state: 'waiting',
        room_level: 'final',
        tournament_id: tournamentId,
        positions: {
          red: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 },
          blue: { tokenA: 0, tokenB: 0, tokenC: 0, tokenD: 0 }
        },
        players: {
          [player1]: 'red',
          [player2]: 'blue'
        },
        pending_steps: { [player1]: 0, [player2]: 0 },
        consecutive_sixes: { [player1]: 0, [player2]: 0 },
        turn: player1
      });
  }

  // Update tournament status to finals
  await supabaseAdmin
    .from('tournaments')
    .update({ status: 'finals' })
    .eq('tournament_id', tournamentId);
}

// Record final room winner (called when a final game ends)
router.post('/final-complete', async (req, res) => {
  try {
    const { roomId, winnerId, loserId, tournamentId } = req.body;

    // Update the final room with winner
    const { data: roomLock, error: roomUpdateError } = await supabaseAdmin
      .from('tournament_rooms')
      .update({ 
        game_state: 'finished', 
        winners: [winnerId] 
      })
      .eq('id', roomId)
      .neq('game_state', 'finished')
      .select('id')
      .maybeSingle();

    if (roomUpdateError) {
      console.error('Error updating final room winner:', roomUpdateError);
      return res.status(500).json({ error: 'Failed to update final room winner' });
    }

    if (roomLock) {
      try {
        await recordMatchResult({
          winnerUserIds: winnerId ? [winnerId] : [],
          loserUserIds: loserId ? [loserId] : [],
        });
      } catch (e) {
        console.error(
          '[UserStats] recordMatchResult failed (tournament final):',
          e?.message ?? e,
        );
      }
    }

    // Check if both final rooms have winners
    const { data: finalRooms } = await supabaseAdmin
      .from('tournament_rooms')
      .select('id, winners')
      .eq('tournament_id', tournamentId)
      .eq('room_level', 'final');

    const roomsWithWinners = finalRooms?.filter(room => 
      room.winners && room.winners.length > 0
    ) || [];

    if (roomsWithWinners.length === 2) {
      // Both finals complete - determine rankings and distribute prizes
      const finalWinners = roomsWithWinners.map(r => r.winners[0]);
      
      // Get tournament for prize distribution
      const { data: tournament } = await supabaseAdmin
        .from('tournaments')
        .select('*')
        .eq('tournament_id', tournamentId)
        .single();

      if (tournament?.status === 'completed') {
        return res.json({
          success: true,
          tournamentComplete: true,
          alreadyCompleted: true,
        });
      }

      const { data: completionLock, error: completionLockErr } = await supabaseAdmin
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('tournament_id', tournamentId)
        .neq('status', 'completed')
        .select('tournament_id')
        .maybeSingle();

      if (completionLockErr) {
        console.error('Error locking tournament completion:', completionLockErr);
        return res.status(500).json({ error: 'Failed to complete tournament' });
      }

      if (!completionLock) {
        return res.json({
          success: true,
          tournamentComplete: true,
          alreadyCompleted: true,
        });
      }

      const prizePool = tournament.reward_amount || 0;
      // Both final winners share 1st place prize equally (50% each of 80%)
      // Losers share remaining 20%
      const prizes = {
        winner: Math.floor(prizePool * 0.40), // Each winner gets 40%
        loser: Math.floor(prizePool * 0.10)   // Each loser gets 10%
      };

      const participants = tournament.tournament_participants || {};
      const rankings = [];

      // Award prizes to winners
      for (const finalWinner of finalWinners) {
        if (!finalWinner.startsWith('bot_')) {
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('total_coins')
            .eq('uid', finalWinner)
            .single();

          if (user) {
            await supabaseAdmin
              .from('users')
              .update({ total_coins: user.total_coins + prizes.winner })
              .eq('uid', finalWinner);
          }
        }

        if (participants[finalWinner]) {
          participants[finalWinner].status = 'winner';
          participants[finalWinner].final_position = 1;
          participants[finalWinner].prize_won = prizes.winner;
        }
        rankings.push(finalWinner);
      }

      // Find and award losers (finalists who didn't win)
      const allFinalists = Object.keys(participants).filter(p => 
        participants[p].status === 'finalist' || participants[p].status === 'winner'
      );
      const losers = allFinalists.filter(p => !finalWinners.includes(p));

      for (const loser of losers) {
        if (!loser.startsWith('bot_')) {
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('total_coins')
            .eq('uid', loser)
            .single();

          if (user) {
            await supabaseAdmin
              .from('users')
              .update({ total_coins: user.total_coins + prizes.loser })
              .eq('uid', loser);
          }
        }

        if (participants[loser]) {
          participants[loser].status = 'runner_up';
          participants[loser].final_position = 2;
          participants[loser].prize_won = prizes.loser;
        }
        rankings.push(loser);
      }

      // Update tournament as completed
      await supabaseAdmin
        .from('tournaments')
        .update({
          final_rankings: rankings,
          tournament_participants: participants,
        })
        .eq('tournament_id', tournamentId);

      try {
        await recordTournamentWon({ winnerUserIds: finalWinners });
      } catch (e) {
        console.error('[UserStats] recordTournamentWon failed:', e?.message ?? e);
      }

      res.json({ 
        success: true, 
        tournamentComplete: true,
        message: 'Tournament completed!',
        winners: finalWinners,
        prizes: { winnerPrize: prizes.winner, loserPrize: prizes.loser }
      });
    } else {
      // Only one final complete, waiting for the other
      res.json({ 
        success: true, 
        tournamentComplete: false,
        completedFinals: roomsWithWinners.length,
        remaining: 2 - roomsWithWinners.length
      });
    }
  } catch (error) {
    console.error('Error completing final:', error);
    res.status(500).json({ error: error.message });
  }
});

// Leave tournament
router.post('/leave', async (req, res) => {
  try {
    const { tournamentId, userId } = req.body;

    const { data: tournament } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('tournament_id', tournamentId)
      .single();

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const participants = tournament.tournament_participants || {};
    delete participants[userId];

    const registeredPlayers = (tournament.registered_players || []).filter(p => p !== userId);

    await supabaseAdmin
      .from('tournaments')
      .update({
        tournament_participants: participants,
        registered_players: registeredPlayers,
        current_players: Math.max(0, tournament.current_players - 1)
      })
      .eq('tournament_id', tournamentId);

    res.json({ success: true, message: 'Left tournament' });
  } catch (error) {
    console.error('Error leaving tournament:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get tournament status (check semifinal/final progress)
router.get('/status/:tournamentId', async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Get tournament
    const { data: tournament, error: tournamentError } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('tournament_id', tournamentId)
      .single();

    if (tournamentError || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get all tournament rooms
    const { data: rooms } = await supabaseAdmin
      .from('tournament_rooms')
      .select('id, room_id, room_level, game_state, winners, players')
      .eq('tournament_id', tournamentId);

    const semifinalRooms = rooms?.filter(r => r.room_level === 'semifinal') || [];
    const finalRooms = rooms?.filter(r => r.room_level === 'final') || [];

    const semifinalsWithWinners = semifinalRooms.filter(r => r.winners && r.winners.length > 0);
    const finalsWithWinners = finalRooms.filter(r => r.winners && r.winners.length > 0);

    res.json({
      success: true,
      tournamentId,
      status: tournament.status,
      semifinals: {
        total: semifinalRooms.length,
        completed: semifinalsWithWinners.length,
        allComplete: semifinalsWithWinners.length === 4,
        rooms: semifinalRooms.map(r => ({
          roomId: r.id,
          roomCode: r.room_id,
          gameState: r.game_state,
          winner: r.winners?.[0] || null,
          players: r.players
        }))
      },
      finals: {
        total: finalRooms.length,
        completed: finalsWithWinners.length,
        allComplete: finalsWithWinners.length === 2,
        rooms: finalRooms.map(r => ({
          roomId: r.id,
          roomCode: r.room_id,
          gameState: r.game_state,
          winner: r.winners?.[0] || null,
          players: r.players
        }))
      },
      participants: tournament.tournament_participants
    });
  } catch (error) {
    console.error('Error getting tournament status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's current room in tournament
router.get('/my-room/:tournamentId/:userId', async (req, res) => {
  try {
    const { tournamentId, userId } = req.params;

    // Find room where user is a player
    const { data: rooms } = await supabaseAdmin
      .from('tournament_rooms')
      .select('*')
      .eq('tournament_id', tournamentId)
      .neq('game_state', 'finished');

    // Find room containing this user
    const userRoom = rooms?.find(room => {
      const players = room.players || {};
      return Object.keys(players).includes(userId);
    });

    if (userRoom) {
      res.json({
        success: true,
        hasRoom: true,
        room: userRoom
      });
    } else {
      // Check if user is waiting for finals
      const { data: tournament } = await supabaseAdmin
        .from('tournaments')
        .select('tournament_participants, status')
        .eq('tournament_id', tournamentId)
        .single();

      const participants = tournament?.tournament_participants || {};
      const userStatus = participants[userId]?.status || 'unknown';

      res.json({
        success: true,
        hasRoom: false,
        userStatus,
        tournamentStatus: tournament?.status
      });
    }
  } catch (error) {
    console.error('Error getting user room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export default router;
