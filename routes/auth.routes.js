// routes/auth.routes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();
const OTP_TTL_MIN = parseInt(process.env.OTP_TTL_MIN || '5', 10);

// ---- Rate-limit to avoid OTP spam ----
const sendLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---- Helpers ----
const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

async function inferRoleByPhone(phone) {
  const [urows] = await pool.query('SELECT role FROM users WHERE phone=? LIMIT 1', [phone]);
  if (urows.length) return urows[0].role;

  const [m1] = await pool.query(
    `SELECT m.id FROM merchants m JOIN users u ON u.id = m.user_id WHERE u.phone=? LIMIT 1`,
    [phone]
  );
  if (m1.length) return 'merchant';

  const [d1] = await pool.query(
    `SELECT db.id FROM delivery_boys db JOIN users u ON u.id = db.user_id WHERE u.phone=? LIMIT 1`,
    [phone]
  );
  if (d1.length) return 'rider';

  const [a1] = await pool.query(`SELECT id FROM admins WHERE phone=? LIMIT 1`, [phone]);
  if (a1.length) return 'admin';

  return 'customer';
}

async function upsertUserByPhone(phone) {
  const [rows] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
  if (rows.length) return rows[0];

  const role = await inferRoleByPhone(phone);
  await pool.query(
    `INSERT INTO users (phone, role, status, kyc_status, created_at) VALUES (?, ?, 'active', 'pending', NOW())`,
    [phone, role]
  );
  const [rows2] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
  return rows2[0];
}

// ---- POST /api/auth/send-otp ----
router.post('/send-otp', sendLimiter, async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!/^[6-9]\d{9}$/.test(phone || '')) {
      return res.status(400).json({ ok: false, message: 'Invalid phone' });
    }

    await upsertUserByPhone(phone);
    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    await pool.query('UPDATE otps SET used = 1 WHERE phone = ? AND used = 0', [phone]);

    await pool.query(
      'INSERT INTO otps (phone, code, expires_at, used) VALUES (?, ?, ?, 0)',
      [phone, code, expiresAt]
    );

    console.log(`[OTP] ${phone} -> ${code} (valid ${OTP_TTL_MIN} min)`);
    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    console.error('send-otp error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// ---- POST /api/auth/verify ----
router.post('/verify', async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!/^[6-9]\d{9}$/.test(phone || '') || !/^\d{6}$/.test(code || '')) {
      return res.status(400).json({ ok: false, message: 'Invalid data' });
    }

    const [rows] = await pool.query(
      `SELECT * FROM otps WHERE phone = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1`,
      [phone, code]
    );
    if (!rows.length) return res.status(400).json({ ok: false, message: 'Invalid OTP' });

    const otpRow = rows[0];
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: 'OTP expired' });
    }

    await pool.query('UPDATE otps SET used = 1 WHERE id = ?', [otpRow.id]);

    const user = await upsertUserByPhone(phone);
    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, message: 'Account not active' });
    }

    let merchant = null;
    if (user.role === 'merchant') {
      const [mrows] = await pool.query('SELECT * FROM merchants WHERE user_id = ? LIMIT 1', [user.id]);
      if (mrows.length) merchant = mrows[0];
    }

    // 👇 updated JWT payload including direct id
    const payload = {
      id: user.id, // 👈 critical fix for req.user.id
      sub: String(user.id),
      role: user.role,
      phone: user.phone,
    };
    if (merchant) payload.merchant_id = merchant.id;

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      ok: true,
      token,
      role: user.role,
      user: { id: user.id, phone: user.phone, name: user.name ?? null },
      data: {
        user: { id: user.id, phone: user.phone },
        merchant: merchant ? merchant : null,
        merchant_id: merchant ? merchant.id : null,
      },
    });
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
