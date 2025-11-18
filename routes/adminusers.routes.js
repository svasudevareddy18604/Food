const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/admin/users
 * Query params:
 *    role=[admin|merchant|rider|customer] (optional)
 *    status=[active|suspended|pending] (optional)
 *    search=string (optional, matches name/phone/email)
 */
router.get('/', async (req, res) => {
  try {
    const { role, status, search } = req.query;

    let sql = `
      SELECT 
        id, name, phone, email, address, role, status, kyc_status, aadhaar,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, count: rows.length, users: rows });
  } catch (err) {
    console.error('[adminusers.list]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/users/:id/status
 * Body: { status: 'active' | 'suspended' }
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const [result] = await pool.query(
      'UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (err) {
    console.error('[adminusers.status]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/users/:id/kyc
 * Body: { kyc_status: 'pending' | 'verified' | 'rejected' }
 */
router.put('/:id/kyc', async (req, res) => {
  try {
    const { id } = req.params;
    const { kyc_status } = req.body;
    if (!['pending', 'verified', 'rejected'].includes(kyc_status)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status' });
    }

    const [result] = await pool.query(
      'UPDATE users SET kyc_status = ?, updated_at = NOW() WHERE id = ?',
      [kyc_status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'KYC status updated successfully' });
  } catch (err) {
    console.error('[adminusers.kyc]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
