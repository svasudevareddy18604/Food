// routes/merchant_operations.routes.js
const express = require('express');
const pool = require('../db');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ----- AUTH MIDDLEWARE -----
function authMerchant(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'merchant') {
      return res.status(403).json({ message: 'Not a merchant token' });
    }

    let merchantId =
      decoded.merchant_id ??
      decoded.merchantId ??
      decoded.sub ??
      decoded.id ??
      decoded.userId;

    if (!merchantId) {
      return res.status(403).json({ message: 'Not a merchant token' });
    }

    if (typeof merchantId === 'string') {
      const parsed = parseInt(merchantId, 10);
      if (!Number.isNaN(parsed)) merchantId = parsed;
    }

    req.merchantId = merchantId;
    next();
  } catch (err) {
    console.error('JWT error in authMerchant:', err);
    return res.status(401).json({ message: 'Invalid token' });
  }
}

/**
 * GET /api/merchant/ops-settings
 */
router.get('/ops-settings', authMerchant, async (req, res) => {
  const merchantId = req.merchantId;

  try {
    const conn = await pool.getConnection();

    try {
      const [settingsRows] = await conn.query(
        'SELECT avg_prep_time_min FROM merchant_settings WHERE merchant_id = ?',
        [merchantId]
      );

      const avgPrepTime =
        settingsRows.length > 0
          ? settingsRows[0].avg_prep_time_min
          : 15;

      const [hoursRows] = await conn.query(
        `SELECT day_of_week, is_open, open_time, close_time
         FROM merchant_operating_hours
         WHERE merchant_id = ?
         ORDER BY day_of_week ASC`,
        [merchantId]
      );

      const hoursMap = new Map();
      for (const row of hoursRows) {
        hoursMap.set(row.day_of_week, row);
      }

      const hours = [];
      for (let d = 0; d < 7; d++) {
        const row = hoursMap.get(d);
        hours.push({
          day_index: d,
          is_open: row ? !!row.is_open : true,
          open_time: row && row.open_time ? row.open_time : null,
          close_time: row && row.close_time ? row.close_time : null,
        });
      }

      conn.release();

      return res.json({
        avg_prep_time_min: avgPrepTime,
        hours,
      });
    } catch (err) {
      conn.release();
      console.error('Error fetching merchant operations:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  } catch (err) {
    console.error('DB conn error (GET /ops-settings):', err);
    return res.status(500).json({ message: 'DB connection error' });
  }
});

/**
 * PUT /api/merchant/ops-settings
 */
router.put('/ops-settings', authMerchant, async (req, res) => {
  const merchantId = req.merchantId;
  const { avg_prep_time_min, hours } = req.body;

  if (!Array.isArray(hours) || hours.length !== 7) {
    return res.status(400).json({ message: 'Hours must have 7 entries' });
  }

  const avgPrep = Number.isInteger(avg_prep_time_min)
    ? avg_prep_time_min
    : 15;

  try {
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        `
        INSERT INTO merchant_settings (merchant_id, avg_prep_time_min)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE avg_prep_time_min = VALUES(avg_prep_time_min)
        `,
        [merchantId, avgPrep]
      );

      for (const entry of hours) {
        const d = parseInt(entry.day_index, 10);
        if (Number.isNaN(d) || d < 0 || d > 6) continue;

        const isOpen = entry.is_open ? 1 : 0;
        const openTime = entry.open_time || null;
        const closeTime = entry.close_time || null;

        await conn.query(
          `
          INSERT INTO merchant_operating_hours
            (merchant_id, day_of_week, is_open, open_time, close_time)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            is_open = VALUES(is_open),
            open_time = VALUES(open_time),
            close_time = VALUES(close_time)
          `,
          [merchantId, d, isOpen, openTime, closeTime]
        );
      }

      await conn.commit();
      conn.release();

      return res.json({ message: 'Merchant operations updated' });
    } catch (err) {
      await conn.rollback();
      conn.release();
      console.error('Error updating merchant operations:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  } catch (err) {
    console.error('DB conn error (PUT /ops-settings):', err);
    return res.status(500).json({ message: 'DB connection error' });
  }
});

/**
 * TEST ROUTE: GET /api/merchant/ops-test
 */
router.get('/ops-test', (req, res) => {
  console.log('💥 OPS TEST ROUTE HIT');
  res.json({ status: 'working' });
});

module.exports = router;
