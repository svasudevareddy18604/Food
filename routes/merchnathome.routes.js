const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const db = require("../db");

// Helper to extract merchant from token
function getMerchant(req) {
  const token = req.header("Authorization")?.replace("Bearer ", "")?.trim();
  if (!token) throw new Error("No token");

  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.role !== "merchant") throw new Error("Not a merchant");

  return payload.sub || payload.id;
}

// GET: Home Dashboard
router.get("/home-dashboard", async (req, res) => {
  try {
    const userId = getMerchant(req);

    // Fetch merchant info
    const [[merchant]] = await db.query(
      `
      SELECT
        m.id AS merchant_id,
        m.store_name AS restaurant_name,
        m.is_open AS is_online
      FROM merchants m
      WHERE m.user_id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!merchant) {
      return res.status(404).json({ message: "Merchant not found" });
    }

    // Get avg prep time
    const [[settings]] = await db.query(
      `SELECT avg_prep_time_min FROM merchant_settings WHERE merchant_id = ?`,
      [merchant.merchant_id]
    );

    const avgPrepTime = settings?.avg_prep_time_min || 15;

    // Fetch today's stats
    const [[stats]] = await db.query(
      `
      SELECT
        COUNT(*) AS today_orders,
        COALESCE(SUM(total), 0) AS today_revenue
      FROM orders
      WHERE restaurant_id = ? AND DATE(created_at) = CURDATE()
      `,
      [merchant.merchant_id]
    );

    // Full response (with avg prep time fix)
    res.json({
      ok: true,
      merchant_id: merchant.merchant_id,
      restaurant_name: merchant.restaurant_name,
      is_online: merchant.is_online,
      avg_prep_time_min: avgPrepTime,
      today_orders: stats.today_orders,
      today_revenue: stats.today_revenue,
      active_orders: [], // You can fill with real data later
      notifications: []  // Same here
    });
  } catch (err) {
    console.error("Error in /home-dashboard:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// PATCH: Toggle Merchant Online/Offline
router.patch("/status", async (req, res) => {
  try {
    const userId = getMerchant(req);
    const { is_online } = req.body;

    const [[merchant]] = await db.query(
      `SELECT id FROM merchants WHERE user_id = ?`,
      [userId]
    );

    if (!merchant) throw new Error("Merchant not found");

    await db.query(`UPDATE merchants SET is_open = ? WHERE id = ?`, [
      is_online ? 1 : 0,
      merchant.id,
    ]);

    res.json({ ok: true, is_online });
  } catch (err) {
    console.error("Error in /status:", err.message);
    res.status(401).json({ message: err.message });
  }
});

// PATCH: Update Avg Prep Time
router.patch("/prep-time", async (req, res) => {
  try {
    const userId = getMerchant(req);
    const { avg_prep_time_min } = req.body;

    if (avg_prep_time_min == null || isNaN(avg_prep_time_min)) {
      throw new Error("Invalid avg_prep_time_min");
    }

    const [[merchant]] = await db.query(
      `SELECT id FROM merchants WHERE user_id = ?`,
      [userId]
    );

    if (!merchant) throw new Error("Merchant not found");

    await db.query(
      `
      INSERT INTO merchant_settings (merchant_id, avg_prep_time_min)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE avg_prep_time_min = VALUES(avg_prep_time_min)
      `,
      [merchant.id, avg_prep_time_min]
    );

    res.json({ ok: true, avg_prep_time_min });
  } catch (err) {
    console.error("Error in /prep-time:", err.message);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
