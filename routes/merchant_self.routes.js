const router = require('express').Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');

// ----------------- extract user ID -----------------
function getUser(req) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.sub;
  } catch {
    return null;
  }
}

// ----------------- GET /api/merchant/me -----------------
router.get('/me', async (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ ok: false, message: "Unauthorized" });

  const [rows] = await pool.query(
    `SELECT store_name, phone FROM merchants WHERE user_id = ? LIMIT 1`,
    [uid]
  );

  if (!rows.length) {
    return res.status(404).json({ ok: false, message: "Merchant not found" });
  }

  res.json({ ok: true, data: rows[0] });
});

// ----------------- PATCH /api/merchant/me/store-status -----------------
router.patch('/me/store-status', async (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ ok: false });

  const next = req.body.store_status === 'open' ? 1 : 0;

  await pool.query(
    `UPDATE merchants SET is_open = ? WHERE user_id = ?`,
    [next, uid]
  );

  res.json({ ok: true, status: next ? 'open' : 'closed' });
});

module.exports = router;
