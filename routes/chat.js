import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting maps
const messageRateLimits = new Map(); // odId -> { count, resetTime }
const giftRateLimits = new Map();

const MAX_MESSAGES_PER_MINUTE = 10;
const MAX_GIFTS_PER_MINUTE = 5;

// Helper: Check rate limit
function checkRateLimit(map, odId, maxPerMinute) {
  const now = Date.now();
  const userLimit = map.get(odId);
  
  if (!userLimit || now > userLimit.resetTime) {
    map.set(odId, { count: 1, resetTime: now + 60000 });
    return true;
  }
  
  if (userLimit.count >= maxPerMinute) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

// Helper: Get table name from room type
function getTableName(roomType) {
  switch (roomType) {
    case 'friend': return 'friend_rooms';
    case 'team_up': return 'team_up_rooms';
    case 'tournament': return 'tournament_rooms';
    default: return 'game_rooms';
  }
}

// Send message to room
router.post('/:roomId/message', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { message, presetId, roomType } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!message || message.length > 160) {
      return res.status(400).json({ error: 'Invalid message (max 160 chars)' });
    }

    // Rate limit check
    if (!checkRateLimit(messageRateLimits, odId, MAX_MESSAGES_PER_MINUTE)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait.' });
    }

    const tableName = getTableName(roomType);
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newMessage = {
      id: messageId,
      sender_id: userId,
      message: message,
      preset_id: presetId || null,
      created_at: new Date().toISOString(),
    };

    // Get current messages
    const { data: room, error: fetchError } = await supabaseAdmin
      .from(tableName)
      .select('room_messages')
      .eq('room_id', roomId)
      .single();

    if (fetchError) {
      console.error('Error fetching room:', fetchError);
      return res.status(404).json({ error: 'Room not found' });
    }

    // Append message (keep last 50)
    const messages = room.room_messages || [];
    messages.push(newMessage);
    if (messages.length > 50) {
      messages.splice(0, messages.length - 50);
    }

    // Update room
    const { error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({ room_messages: messages })
      .eq('room_id', roomId);

    if (updateError) {
      console.error('Error updating room:', updateError);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    console.log(`💬 [CHAT] Message sent by ${userId} in ${roomId}: ${message}`);
    res.json({ success: true, message: newMessage });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send gift/emoji to player
router.post('/:roomId/gift', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { recipientId, emojiId, cost, roomType } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!recipientId || !emojiId) {
      return res.status(400).json({ error: 'Missing recipientId or emojiId' });
    }

    if (recipientId === userId) {
      return res.status(400).json({ error: 'Cannot send gift to yourself' });
    }

    // Rate limit check
    if (!checkRateLimit(giftRateLimits, odId, MAX_GIFTS_PER_MINUTE)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait.' });
    }

    const giftCost = cost || 0;

    // Check and deduct coins if cost > 0
    if (giftCost > 0) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('total_coins')
        .eq('uid', userId)
        .single();

      if (userError || !userData) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (userData.total_coins < giftCost) {
        return res.status(400).json({ error: 'Insufficient coins' });
      }

      // Deduct coins
      await supabaseAdmin
        .from('users')
        .update({ total_coins: userData.total_coins - giftCost })
        .eq('uid', userId);
    }

    const tableName = getTableName(roomType);
    const giftId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newGift = {
      id: giftId,
      sender_id: userId,
      recipient_id: recipientId,
      emoji_id: emojiId,
      cost: giftCost,
      created_at: new Date().toISOString(),
    };

    // Get current gifts
    const { data: room, error: fetchError } = await supabaseAdmin
      .from(tableName)
      .select('room_gifts')
      .eq('room_id', roomId)
      .single();

    if (fetchError) {
      console.error('Error fetching room:', fetchError);
      return res.status(404).json({ error: 'Room not found' });
    }

    // Append gift (keep last 100)
    const gifts = room.room_gifts || [];
    gifts.push(newGift);
    if (gifts.length > 100) {
      gifts.splice(0, gifts.length - 100);
    }

    // Update room
    const { error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({ room_gifts: gifts })
      .eq('room_id', roomId);

    if (updateError) {
      console.error('Error updating room:', updateError);
      return res.status(500).json({ error: 'Failed to send gift' });
    }

    // Update gift stats
    try {
      // Sender stats
      await supabaseAdmin.rpc('increment_gift_sent', { user_id: userId, amount: giftCost });
      // Recipient stats
      await supabaseAdmin.rpc('increment_gift_received', { user_id: recipientId });
    } catch (statsError) {
      console.warn('Failed to update gift stats:', statsError);
    }

    console.log(`🎁 [GIFT] ${emojiId} sent by ${userId} to ${recipientId} (cost: ${giftCost})`);
    res.json({ success: true, gift: newGift });
  } catch (error) {
    console.error('Error sending gift:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get gift catalog
router.get('/catalog', async (req, res) => {
  try {
    const { data: catalog, error } = await supabaseAdmin
      .from('gift_catalog')
      .select('*')
      .order('sort_order');

    if (error) {
      console.error('Error fetching catalog:', error);
      return res.status(500).json({ error: 'Failed to fetch catalog' });
    }

    res.json({ success: true, catalog });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user gift stats
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: stats, error } = await supabaseAdmin
      .from('user_gift_stats')
      .select('*')
      .eq('user_id', odId)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found is ok
      console.error('Error fetching stats:', error);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }

    res.json({
      success: true,
      stats: stats || { gifts_sent: 0, gifts_received: 0, total_coins_spent: 0 },
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
