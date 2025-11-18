// routes/customer.routes.js

const express = require("express");
const pool = require("../db");

const router = express.Router();

// Base URL for client
const BASE_URL = process.env.BASE_URL || "http://192.168.1.101:3000";

// ---------- FORMATTERS ----------
function mapMenu(row) {
  return {
    id: row.id,
    dish_name: row.name,
    price: row.price,
    image: row.image_url
      ? `${BASE_URL}${row.image_url}`
      : "https://via.placeholder.com/300x300.png?text=No+Image",
    restaurant_name: row.store_name,
    is_open: row.is_open,
    is_veg: row.is_veg,
    category: row.category,
  };
}

function mapPromo(row) {
  return {
    id: row.id,
    title: row.title,
    image: row.image
      ? `${BASE_URL}${row.image}`
      : null,
  };
}

// ---------- MENU API ----------
// GET /api/customer/menu
router.get("/menu", async (req, res) => {
  try {
    const { category } = req.query;

    let query = `
      SELECT 
        i.id,
        i.name,
        i.price,
        i.image_url,
        i.category,
        i.is_veg,
        m.store_name,
        m.is_open
      FROM menu_items i
      JOIN merchants m ON m.id = i.merchant_id
      WHERE m.status = 'active'
    `;

    const params = [];

    if (category && category !== "All") {
      query += ` AND LOWER(i.category) = ?`;
      params.push(category.toLowerCase());
    }

    query += ` ORDER BY i.id DESC`;

    const [rows] = await pool.query(query, params);

    res.json({
      ok: true,
      data: rows.map(mapMenu),
    });
  } catch (err) {
    console.error("❌ GET /menu error:", err);
    res.status(500).json({ ok: false, message: "Server error fetching menu" });
  }
});

// ---------- PROMOTIONS API ----------
// ---------- PROMOTIONS API ----------
// GET /api/customer/promotions
router.get("/promotions", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, title, subtitle, media_url, type
      FROM promotions
      WHERE status = 'Active'
      ORDER BY id DESC
    `);

    const data = rows.map(p => ({
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      type: p.type,
      media_url: p.media_url ? `${BASE_URL}${p.media_url}` : null,
    }));

    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ GET /promotions error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load promotions"
    });
  }
});

module.exports = router;
