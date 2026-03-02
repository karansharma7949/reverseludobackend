import express from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Create or get user profile
router.post('/profile', authenticateUser, async (req, res) => {
  try {
    const { uid, username, email, avatarUrl } = req.body;

    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized: Cannot create profile for another user' });
    }

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('uid', uid)
      .single();

    if (existingUser) {
      return res.json({ success: true, user: existingUser, isNew: false });
    }

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

// Get user profile
router.get('/:uid', authenticateUser, async (req, res) => {
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

// Update user coins (add/subtract from existing)
router.patch('/:uid/coins', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;
    const { amount } = req.body;

    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // First get current coins
    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('total_coins')
      .eq('uid', uid)
      .single();

    if (fetchError) throw fetchError;

    // Calculate new total (add amount to existing coins)
    const newTotal = Math.max(0, (currentUser.total_coins || 0) + amount);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ total_coins: newTotal })
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user diamonds (add/subtract from existing)
router.patch('/:uid/diamonds', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;
    const { amount } = req.body;

    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // First get current diamonds
    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('total_diamonds')
      .eq('uid', uid)
      .single();

    if (fetchError) throw fetchError;

    // Calculate new total (add amount to existing diamonds)
    const newTotal = Math.max(0, (currentUser.total_diamonds || 0) + amount);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ total_diamonds: newTotal })
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload profile image
router.post('/:uid/upload-avatar', authenticateUser, upload.single('avatar'), async (req, res) => {
  try {
    const { uid } = req.params;
    const file = req.file;

    if (req.user.id !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = `${uid}_${Date.now()}.${file.mimetype.split('/')[1]}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(fileName);

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

export default router;
