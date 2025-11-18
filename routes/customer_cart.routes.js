// routes/customer_cart.routes.js

const express = require('express');
const pool = require('../db');
const router = express.Router();

const CUSTOMER_ID = 1; // TODO: replace with req.user.id after login

/** Helper to get base delivery fee */
async function getBaseDeliveryFee() {
  const [[settings]] = await pool.query(
    `SELECT base_delivery_fee FROM app_settings WHERE id = 1 LIMIT 1`
  );
  return Number(settings?.base_delivery_fee) || 0;
}

/** 🛒 ADD ITEM TO CART */
router.post('/cart', async (req, res) => {
  try {
    const { menu_item_id, quantity = 1 } = req.body;

    if (!menu_item_id) {
      return res.status(400).json({ ok: false, message: 'menu_item_id required' });
    }

    const [[exists]] = await pool.query(
      `SELECT id FROM cart WHERE customer_id = ? AND menu_item_id = ?`,
      [CUSTOMER_ID, menu_item_id]
    );

    if (exists) {
      await pool.query(
        `UPDATE cart SET quantity = quantity + ? WHERE id = ?`,
        [quantity, exists.id]
      );
    } else {
      await pool.query(
        `INSERT INTO cart (customer_id, menu_item_id, quantity) VALUES (?, ?, ?)`,
        [CUSTOMER_ID, menu_item_id, quantity]
      );
    }

    return res.json({ ok: true, message: 'Added to cart' });
  } catch (err) {
    console.error('ADD TO CART ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/** 🛒 GET CART */
router.get('/cart', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        c.id,
        c.menu_item_id,
        c.quantity AS qty,
        m.name AS dish_name,
        m.price,
        m.image_url AS image
      FROM cart c
      JOIN menu_items m ON c.menu_item_id = m.id
      WHERE c.customer_id = ?
      ORDER BY c.id ASC`,
      [CUSTOMER_ID]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('CART FETCH ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/** 📊 CART SUMMARY (with totals + delivery) */
router.get('/cart/summary', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        m.price,
        c.quantity AS qty
      FROM cart c
      JOIN menu_items m ON c.menu_item_id = m.id
      WHERE c.customer_id = ?`,
      [CUSTOMER_ID]
    );

    let subtotal = 0;
    rows.forEach(item => {
      subtotal += Number(item.price) * Number(item.qty);
    });

    const baseFee = await getBaseDeliveryFee();
    const deliveryFee = subtotal >= 499 ? 0 : baseFee;
    const total = subtotal + deliveryFee;

    return res.json({
      ok: true,
      data: {
        subtotal,
        delivery_fee: deliveryFee,
        total,
      },
    });
  } catch (err) {
    console.error('CART SUMMARY ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/** ♻ UPDATE QTY */
router.put('/cart/:id', async (req, res) => {
  try {
    const { qty } = req.body;
    const { id } = req.params;

    if (qty < 1) {
      await pool.query(
        `DELETE FROM cart WHERE id = ? AND customer_id = ?`,
        [id, CUSTOMER_ID]
      );
      return res.json({ ok: true, message: 'Removed from cart' });
    }

    await pool.query(
      `UPDATE cart SET quantity = ? WHERE id = ? AND customer_id = ?`,
      [qty, id, CUSTOMER_ID]
    );

    return res.json({ ok: true, message: 'Quantity updated' });
  } catch (err) {
    console.error('UPDATE CART ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/** ❌ DELETE ITEM */
router.delete('/cart/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `DELETE FROM cart WHERE id = ? AND customer_id = ?`,
      [id, CUSTOMER_ID]
    );

    return res.json({ ok: true, message: 'Item deleted' });
  } catch (err) {
    console.error('DELETE CART ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
