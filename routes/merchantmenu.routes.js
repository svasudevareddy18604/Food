const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ---------- MULTER SETUP (UPLOAD DIR) ----------
const uploadDir = path.join(__dirname, '..', 'uploads', 'menu');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'item', ext);
    const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, `${safeBase}-${Date.now()}${ext || '.jpg'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---------- JWT MIDDLEWARE ----------
function requireJwt(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !String(auth).startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, message: 'Missing token' });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.authUser = decoded; // sub = user_id
    next();
  } catch (err) {
    console.error('JWT error:', err);
    return res.status(401).json({ ok: false, message: 'Invalid token' });
  }
}

// ---------- HELPER ----------
function mapMenuRow(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    category: row.category,
    isVeg: row.is_veg === 1,
    isAvailable: row.is_available === 1,
    prepTimeMin: row.prep_time_min,
    imageUrl: row.image_url,
  };
}

// ---------- POST /menu-items ----------
router.post('/menu-items', requireJwt, upload.single('image'), async (req, res) => {
  try {
    const userId = Number(req.authUser.sub);
    const [[merchant]] = await pool.query(
      'SELECT id FROM merchants WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (!merchant) return res.status(403).json({ ok: false, message: 'Merchant not found' });

    const {
      name,
      price,
      description,
      category,
      is_veg,
      is_available,
      prep_time_min,
    } = req.body;

    if (!name || isNaN(price) || Number(price) <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid name or price' });
    }

    const imageUrl = req.file ? `/uploads/menu/${req.file.filename}` : null;

    const [result] = await pool.query(
      `INSERT INTO menu_items (merchant_id, name, description, price, category, is_veg, is_available, prep_time_min, image_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        merchant.id,
        name.trim(),
        description?.trim() || null,
        Number(price),
        category?.trim() || null,
        is_veg == 1,
        is_available == 1,
        parseInt(prep_time_min, 10) || 15,
        imageUrl,
      ]
    );

    const [[newItem]] = await pool.query('SELECT * FROM menu_items WHERE id = ?', [
      result.insertId,
    ]);
    return res.status(201).json({ ok: true, data: mapMenuRow(newItem) });
  } catch (err) {
    console.error('POST /menu-items error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// ---------- GET /menu-items ----------
router.get('/menu-items', requireJwt, async (req, res) => {
  try {
    const userId = Number(req.authUser.sub);
    const [[merchant]] = await pool.query(
      'SELECT id FROM merchants WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (!merchant) return res.status(403).json({ ok: false, message: 'Merchant not found' });

    const [rows] = await pool.query('SELECT * FROM menu_items WHERE merchant_id = ?', [
      merchant.id,
    ]);

    return res.json({ ok: true, data: rows.map(mapMenuRow) });
  } catch (err) {
    console.error('GET /menu-items error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// ---------- PATCH /menu-items/:id ----------
router.patch('/menu-items/:id', requireJwt, upload.single('image'), async (req, res) => {
  try {
    const userId = Number(req.authUser.sub);
    const itemId = Number(req.params.id);

    const [[item]] = await pool.query(
      `SELECT mi.*, m.user_id FROM menu_items mi
       JOIN merchants m ON mi.merchant_id = m.id WHERE mi.id = ? LIMIT 1`,
      [itemId]
    );

    if (!item || item.user_id !== userId) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    const {
      name,
      price,
      description,
      category,
      is_veg,
      is_available,
      prep_time_min,
    } = req.body;

    const updates = {};
    if (name) updates.name = name.trim();
    if (price) updates.price = Number(price);
    if (description) updates.description = description.trim();
    if (category) updates.category = category.trim();
    if (typeof is_veg !== 'undefined') updates.is_veg = is_veg == 1;
    if (typeof is_available !== 'undefined') updates.is_available = is_available == 1;
    if (prep_time_min) updates.prep_time_min = parseInt(prep_time_min, 10);

    if (req.file) updates.image_url = `/uploads/menu/${req.file.filename}`;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ ok: false, message: 'No valid fields to update' });
    }

    const fields = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    await pool.query(`UPDATE menu_items SET ${fields} WHERE id = ?`, [...values, itemId]);

    const [[updatedItem]] = await pool.query('SELECT * FROM menu_items WHERE id = ?', [itemId]);
    return res.json({ ok: true, data: mapMenuRow(updatedItem) });
  } catch (err) {
    console.error('PATCH /menu-items/:id error:', err);
    return res.status(500).json({ ok: false, message: 'Server error updating item' });
  }
});

// ---------- DELETE /menu-items/:id ----------
router.delete('/menu-items/:id', requireJwt, async (req, res) => {
  try {
    const userId = Number(req.authUser.sub);
    const itemId = Number(req.params.id);

    const [[item]] = await pool.query(
      `SELECT mi.*, m.user_id FROM menu_items mi
       JOIN merchants m ON mi.merchant_id = m.id WHERE mi.id = ? LIMIT 1`,
      [itemId]
    );

    if (!item || item.user_id !== userId) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    await pool.query('DELETE FROM menu_items WHERE id = ?', [itemId]);
    return res.json({ ok: true, message: 'Item deleted successfully' });
  } catch (err) {
    console.error('DELETE /menu-items/:id error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
