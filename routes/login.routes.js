// routes/auth.routes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();
const OTP_TTL_MIN = parseInt(process.env.OTP_TTL_MIN || '5', 10);

// Rate-limit to avoid OTP spam
const sendLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// Helpers
const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

async function upsertUserByPhone(phone) {
  const [rows] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
  if (rows.length) return rows[0];
  await pool.query(
    'INSERT INTO users (phone, role, status) VALUES (?, ?, ?)',
    [phone, 'customer', 'active']
  );
  const [rows2] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
  return rows2[0];
}

// POST /api/auth/send-otp
router.post('/send-otp', sendLimiter, async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!/^[6-9]\d{9}$/.test(phone || '')) {
      return res.status(400).json({ ok: false, message: 'Invalid phone' });
    }

    // Ensure user exists
    await upsertUserByPhone(phone);

    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    // Invalidate old unused OTPs for this phone
    await pool.query('UPDATE otps SET used = 1 WHERE phone = ? AND used = 0', [phone]);

    // Save new OTP
    await pool.query(
      'INSERT INTO otps (phone, code, expires_at, used) VALUES (?, ?, ?, 0)',
      [phone, code, expiresAt]
    );

    // TODO: integrate SMS. For now, print to server logs.
    console.log(`[OTP] ${phone} -> ${code} (valid ${OTP_TTL_MIN} min)`);

    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    console.error('send-otp error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// POST /api/auth/verify
router.post('/verify', async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!/^[6-9]\d{9}$/.test(phone || '') || !/^\d{6}$/.test(code || '')) {
      return res.status(400).json({ ok: false, message: 'Invalid data' });
    }

    // Get latest non-used OTP
    const [rows] = await pool.query(
      `SELECT * FROM otps
       WHERE phone = ? AND code = ? AND used = 0
       ORDER BY id DESC
       LIMIT 1`,
      [phone, code]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, message: 'Invalid OTP' });
    }

    const otpRow = rows[0];
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: 'OTP expired' });
    }

    // Mark OTP used
    await pool.query('UPDATE otps SET used = 1 WHERE id = ?', [otpRow.id]);

    // Fetch user + role
    const [urows] = await pool.query(
      'SELECT id, phone, role, status FROM users WHERE phone = ? LIMIT 1',
      [phone]
    );
    if (!urows.length) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }
    const user = urows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, message: 'Account not active' });
    }

    const token = jwt.sign(
      { sub: String(user.id), role: user.role, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      ok: true,
      token,
      role: user.role,
      user: { id: user.id, phone: user.phone },
    });
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
