// routes/merchant_profile.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

/**
 * Helper: extract payload from JWT
 * JWT payload (from auth.routes.js) looks like:
 * { sub: "<user_id>", role: "merchant" | "...", phone: "...", merchant_id? }
 */
function getAuthPayload(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload;
  } catch (err) {
    console.error('Invalid JWT in /merchant/profile:', err.message);
    return null;
  }
}

/**
 * GET /api/merchant/profile
 * Returns the logged-in merchant's profile (ONLY merchants)
 *
 * Joins:
 *   users     (id, phone, email, name, address, role, status, ...)
 *   merchants (id, store_name, owner_name, phone, email, address, city,
 *              category, gst, fssai, merchant_code, status, is_open, owner_phone, ...)
 */
router.get('/profile', async (req, res) => {
  try {
    const payload = getAuthPayload(req);

    if (!payload) {
      return res.status(401).json({
        ok: false,
        message: 'Unauthorized: missing or invalid token',
      });
    }

    const userId = payload.sub || payload.user_id || payload.id;
    const role = payload.role;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: 'Unauthorized: invalid token payload',
      });
    }

    // Only allow merchants
    if (role !== 'merchant') {
      return res.status(403).json({
        ok: false,
        message: 'Forbidden: only merchants can access this profile',
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        m.id                AS merchant_id,
        m.store_name,
        m.owner_name,
        m.phone             AS merchant_phone,
        m.owner_phone,
        m.email             AS merchant_email,
        m.address           AS merchant_address,
        m.city,
        m.category,
        m.gst,
        m.fssai,
        m.merchant_code,
        m.status            AS merchant_status,
        m.is_open,
        m.approved_at,
        m.created_at        AS merchant_created_at,
        m.updated_at        AS merchant_updated_at,

        u.id                AS user_id,
        u.phone             AS user_phone,
        u.email             AS user_email,
        u.address           AS user_address,
        u.role              AS user_role,
        u.status            AS user_status,
        u.kyc_status,
        u.aadhaar,
        u.name              AS user_name,
        u.created_at        AS user_created_at,
        u.updated_at        AS user_updated_at
      FROM merchants m
      JOIN users u ON m.user_id = u.id
      WHERE u.id = ? AND u.role = 'merchant'
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: 'Merchant profile not found for this user',
      });
    }

    const row = rows[0];

    const profile = {
      merchant_id: row.merchant_id,
      user_id: row.user_id,

      store_name: row.store_name,
      owner_name: row.owner_name,
      phone: row.merchant_phone || row.user_phone,
      owner_phone: row.owner_phone || null,
      email: row.merchant_email || row.user_email || null,
      address: row.merchant_address || row.user_address || '',
      city: row.city || '',
      category: row.category || '',

      gst: row.gst || '',
      fssai: row.fssai || '',
      merchant_code: row.merchant_code || '',

      status: row.merchant_status,          // "active" / "inactive"
      is_open: !!row.is_open,               // boolean

      approved_at: row.approved_at,
      created_at: row.merchant_created_at,
      updated_at: row.merchant_updated_at,

      user: {
        id: row.user_id,
        phone: row.user_phone,
        email: row.user_email,
        address: row.user_address,
        name: row.user_name,
        role: row.user_role,
        status: row.user_status,
        kyc_status: row.kyc_status,
        aadhaar: row.aadhaar,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
      },
    };

    return res.json({
      ok: true,
      data: profile,
    });
  } catch (err) {
    console.error('Error in GET /api/merchant/profile:', err);
    return res.status(500).json({
      ok: false,
      message: 'Server error while fetching merchant profile',
    });
  }
});

module.exports = router;
