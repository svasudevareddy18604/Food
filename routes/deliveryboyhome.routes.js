// backend/routes/deliveryboyhome.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

/**
 * Helper: extract userId from JWT (supports { sub, id, user_id })
 */
function getUserIdFromReq(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Logging for debug
    console.log('🔑 JWT payload:', payload);

    // Extract valid user ID
    return payload.sub || payload.user_id || payload.id || null;
  } catch (err) {
    console.error('❌ JWT verification failed:', err.message);
    return null;
  }
}

/** Normalize online_status ('online' or 'offline') */
function safeOnlineStatus(s) {
  const v = String(s || '').toLowerCase();
  return v === 'online' ? 'online' : 'offline';
}

/**
 * GET /api/delivery/me
 * Returns logged-in delivery boy profile
 */
router.get('/me', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        d.id AS delivery_id,
        d.user_id,
        u.name,
        u.phone,
        u.email,
        u.status AS user_status,
        u.kyc_status AS user_kyc_status,
        d.vehicle,
        d.vehicle_number,
        d.license_no,
        d.aadhaar,
        d.bank_name,
        d.account_no,
        d.ifsc,
        d.upi,
        d.area,
        d.online_status,
        d.kyc_status,
        d.approval_status,
        d.rejected_reason,
        d.approved_at,
        d.created_at,
        d.updated_at
      FROM delivery_boys d
      JOIN users u ON d.user_id = u.id
      WHERE d.user_id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: 'Delivery profile not found. Please contact support.',
      });
    }

    const row = rows[0];

    res.json({
      ok: true,
      data: {
        id: row.delivery_id,
        user_id: row.user_id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        user_status: row.user_status,
        user_kyc_status: row.user_kyc_status,
        vehicle: row.vehicle,
        vehicle_number: row.vehicle_number,
        area: row.area,
        online_status: row.online_status || 'offline',
        kyc_status: row.kyc_status || row.user_kyc_status || 'pending',
        approval_status: row.approval_status || 'pending',
        rejected_reason: row.rejected_reason,
        approved_at: row.approved_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        bank_name: row.bank_name,
        account_no: row.account_no,
        ifsc: row.ifsc,
        upi: row.upi,
      },
    });
  } catch (err) {
    console.error('💥 Unexpected error in GET /me:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/**
 * PATCH /api/delivery/me/online-status
 * Body: { online_status: "online" | "offline" }
 */
router.patch('/me/online-status', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const onlineStatus = safeOnlineStatus(req.body?.online_status);

    const [result] = await pool.query(
      `
      UPDATE delivery_boys
      SET online_status = ?, updated_at = NOW()
      WHERE user_id = ?
      `,
      [onlineStatus, userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        ok: false,
        message: 'Delivery profile not found for update.',
      });
    }

    res.json({ ok: true, online_status: onlineStatus });
  } catch (err) {
    console.error('💥 Unexpected error in PATCH /online-status:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
