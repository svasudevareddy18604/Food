const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const db = require('../db');

const upload = multer({ dest: 'uploads/customers/' });

// GET: /api/customer/profile
router.get('/profile', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      'SELECT id, name, phone, profile_image AS avatar FROM users WHERE id = ? AND role = "customer"',
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Error in GET /profile:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

// PUT: /api/customer/profile
router.put('/profile', auth, async (req, res) => {
  const userId = req.user.id;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    await db.query(
      'UPDATE users SET name = ? WHERE id = ? AND role = "customer"',
      [name, userId]
    );

    return res.json({ ok: true, message: 'Profile updated' });
  } catch (err) {
    console.error('Error in PUT /profile:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

// POST: /api/customer/profile/image-upload
router.post(
  '/profile/image-upload',
  auth,
  upload.single('image'),
  async (req, res) => {
    try {
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ message: 'Image is required' });
      }

      const filePath = `/uploads/customers/${req.file.filename}`;

      await db.query(
        'UPDATE users SET profile_image = ? WHERE id = ? AND role = "customer"',
        [filePath, userId]
      );

      return res.json({
        ok: true,
        message: 'Image uploaded',
        imageUrl: filePath,
      });
    } catch (err) {
      console.error('Error in POST /image-upload:', err);
      return res.status(500).json({ message: 'Server error: ' + err.message });
    }
  }
);

module.exports = router;
