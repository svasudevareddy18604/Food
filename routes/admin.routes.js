const express = require('express');
const router = express.Router();
const pool = require('../db');

/* ---------- HELPERS ---------- */
async function tableExists(name) {
  const [r] = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = ?
    LIMIT 1
  `, [name]);
  return r.length > 0;
}

async function columnExists(table, column) {
  const [r] = await pool.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
  `, [table, column]);
  return r.length > 0;
}

async function scalar(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  const val = rows?.[0]?.v ?? Object.values(rows?.[0] ?? {})[0] ?? 0;
  return Number(val) || 0;
}

/* ---------- ROUTES ---------- */

// Ping route
router.get('/ping', (req, res) =>
  res.json({ ok: true, route: 'admin', ts: Date.now() })
);

// Get admin profile
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, email, phone, role, profile_image
      FROM users
      WHERE role = 'admin'
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return res.json({ ok: false, error: 'Admin user not found' });
    }

    const admin = rows[0];
    res.json({ ok: true, data: admin });
  } catch (err) {
    console.error('[admin.profile]', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch admin profile',
      details: err.message,
    });
  }
});

// Stats route for Admin Dashboard
router.get('/stats', async (req, res) => {
  try {
    const hasMerchants = await tableExists('merchants');
    const hasRiders = await tableExists('riders');
    const hasDeliveryBoys = await tableExists('delivery_boys');
    const hasUsers = await tableExists('users');
    const hasOrders = await tableExists('orders');

    let merchants = 0;
    let riders = 0;
    let ordersToday = 0;
    let live = 0;

    // --- MERCHANTS ---
    if (hasMerchants) {
      const hasStatus = await columnExists('merchants', 'status');
      const where = hasStatus ? `WHERE status='active'` : '';
      merchants = await scalar(`SELECT COUNT(*) AS v FROM merchants ${where}`);
    } else if (hasUsers) {
      merchants = await scalar(`
        SELECT COUNT(*) AS v FROM users
        WHERE role IN ('merchant','merchant_owner','vendor')
      `);
    }

    // --- RIDERS ---
    if (hasDeliveryBoys) {
      riders = await scalar(`SELECT COUNT(*) AS v FROM delivery_boys`);
    } else if (hasRiders) {
      riders = await scalar(`SELECT COUNT(*) AS v FROM riders`);
    } else if (hasUsers) {
      riders = await scalar(`
        SELECT COUNT(*) AS v FROM users
        WHERE role IN ('rider','delivery','driver','dasher')
      `);
    }

    // --- ORDERS ---
    if (hasOrders) {
      const hasCreatedAt = await columnExists('orders', 'created_at');
      const hasStatus = await columnExists('orders', 'status');

      if (hasCreatedAt) {
        ordersToday = await scalar(`
          SELECT COUNT(*) AS v
          FROM orders
          WHERE DATE(created_at) = CURDATE()
        `);
      }

      if (hasStatus) {
        live = await scalar(`
          SELECT COUNT(*) AS v
          FROM orders
          WHERE status IN ('confirmed','preparing','picked_up','out_for_delivery')
        `);
      }
    }

    // --- RESPONSE ---
    res.json({
      ok: true,
      data: {
        merchants,
        riders,
        ordersToday,
        live,
      },
    });
  } catch (err) {
    console.error('[admin.stats]', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to load admin stats',
      details: err.message,
    });
  }
});

module.exports = router;
