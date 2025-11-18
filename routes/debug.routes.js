// routes/debug.routes.js
const express = require('express');
const pool = require('../db');
const router = express.Router();

router.get('/debug/user-merchant', async (req, res) => {
  try {
    const phone = req.query.phone;
    const userId = req.query.userId ? Number(req.query.userId) : null;

    if (!phone && !userId) return res.status(400).json({ ok: false, message: 'Provide phone or userId' });

    let user = null;
    if (userId) {
      const [urows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      if (urows.length) user = urows[0];
    }
    if (!user && phone) {
      const [urows2] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
      if (urows2.length) user = urows2[0];
    }

    // merchant by user_id
    let merchantByUser = null;
    if (user && user.id) {
      const [mrows] = await pool.query('SELECT * FROM merchants WHERE user_id = ? LIMIT 1', [user.id]);
      if (mrows.length) merchantByUser = mrows[0];
    }

    // merchant by phone
    let merchantByPhone = null;
    if (phone) {
      const [m2] = await pool.query('SELECT * FROM merchants WHERE phone = ? OR owner_phone = ? LIMIT 1', [phone, phone]);
      if (m2.length) merchantByPhone = m2[0];
    }

    return res.json({ ok: true, user, merchantByUser, merchantByPhone });
  } catch (e) {
    console.error('debug error', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
