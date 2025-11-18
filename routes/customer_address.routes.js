// routes/customer_address.routes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const auth = require("../middleware/auth");

// Add Customer Address
router.post("/address", auth, async (req, res) => {
  try {
    const { name, phone, address, landmark, city, pincode, type } = req.body;
    const userId = req.user.id;

    if (!name || !phone || !address || !city || !pincode) {
      return res.json({ ok: false, message: "Missing required fields" });
    }

    await pool.query(
      `INSERT INTO customer_addresses (user_id, name, phone, address, landmark, city, pincode, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, phone, address, landmark, city, pincode, type]
    );

    return res.json({ ok: true, message: "Address saved successfully" });
  } catch (err) {
    console.error("❌ Address insert failed:", err);
    return res.json({ ok: false, message: "Server error" });
  }
});

// Get Customer Addresses
router.get("/address", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("❌ Fetch addresses failed:", err);
    return res.json({ ok: false, message: "Server error" });
  }
});

// Update Customer Address
router.put("/address/:id", auth, async (req, res) => {
  try {
    const addressId = req.params.id;
    const userId = req.user.id;
    const { name, phone, address, landmark, city, pincode, type } = req.body;

    if (!name || !phone || !address || !city || !pincode) {
      return res.json({ ok: false, message: "Required fields missing" });
    }

    const [result] = await pool.query(
      `UPDATE customer_addresses
       SET name = ?, phone = ?, address = ?, landmark = ?, city = ?, pincode = ?, type = ?
       WHERE id = ? AND user_id = ?`,
      [name, phone, address, landmark, city, pincode, type, addressId, userId]
    );

    if (result.affectedRows === 0) {
      return res.json({ ok: false, message: "Address not found or not yours" });
    }

    return res.json({ ok: true, message: "Address updated successfully" });
  } catch (err) {
    console.error("❌ Update address failed:", err);
    return res.json({ ok: false, message: "Server error" });
  }
});

// Delete Address
router.delete("/address/:id", auth, async (req, res) => {
  try {
    const addressId = req.params.id;
    const userId = req.user.id;

    const [result] = await pool.query(
      `DELETE FROM customer_addresses WHERE id = ? AND user_id = ?`,
      [addressId, userId]
    );

    if (result.affectedRows === 0) {
      return res.json({ ok: false, message: "Address not found or not yours" });
    }

    return res.json({ ok: true, message: "Address deleted successfully" });
  } catch (err) {
    console.error("❌ Delete address failed:", err);
    return res.json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
