const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * Fetch menu items for a customer by merchant ID
 */
router.get('/menu', async (req, res) => {
  try {
    const { merchant_id } = req.query;

    if (!merchant_id) {
      return res.status(400).json({ ok: false, message: 'Merchant ID required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name AS dish_name, image_url AS image, price, prep_time_min
       FROM menu_items
       WHERE merchant_id = ? AND is_available = 1
       ORDER BY id ASC`,
      [merchant_id]
    );

    const data = rows.map(row => ({
      id: row.id,
      dish_name: row.dish_name,
      image: row.image,
      price: Number(row.price),
      prep_time_min: row.prep_time_min ?? 15, // fallback
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("MENU FETCH ERROR:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * Fetch merchant settings (e.g. average preparation time)
 */
router.get('/merchant-settings', async (req, res) => {
  try {
    const { merchant_id } = req.query;

    if (!merchant_id) {
      return res.status(400).json({ ok: false, message: 'Merchant ID required' });
    }

    const [rows] = await pool.query(
      `SELECT avg_prep_time_min
       FROM merchant_settings
       WHERE merchant_id = ?`,
      [merchant_id]
    );

    if (rows.length === 0) {
      return res.json({ ok: false, message: "Settings not found", data: {} });
    }

    return res.json({
      ok: true,
      data: {
        avg_prep_time_min: rows[0].avg_prep_time_min
      }
    });
  } catch (err) {
    console.error("MERCHANT SETTINGS ERROR:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
