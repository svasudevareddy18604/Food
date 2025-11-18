// routes/adminriders.routes.js
const express = require('express');
const pool = require('../db');
const router = express.Router();

// -------- utils --------
const isPhone10 = (s) => /^\d{10}$/.test(String(s || '').trim());
const isEmail = (s) => !s ? true : /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.test(String(s || '').trim());
const now = () => new Date();

// ---------- CREATE RIDER ----------
// POST /api/admin/riders
// Body: { name, phone*, email?, address?, vehicle, vehicle_no, license_no, aadhaar, bank_name, account_no, ifsc, upi, online, status, kyc_status }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const phone = String(b.phone || '').trim();

    if (!isPhone10(phone)) {
      return res.status(400).json({ ok: false, message: 'Valid 10-digit phone required' });
    }
    if (!isEmail(b.email)) {
      return res.status(400).json({ ok: false, message: 'Invalid email' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // unique phone
      const [dupe] = await conn.execute('SELECT id FROM users WHERE phone=? LIMIT 1', [phone]);
      if (dupe.length) {
        await conn.rollback();
        return res.status(409).json({ ok: false, message: 'Phone already exists' });
      }

      // insert user
      const [u] = await conn.execute(
        `INSERT INTO users (phone, email, role, status, name, address, created_at)
         VALUES (?, ?, 'rider', ?, ?, ?, NOW())`,
        [
          phone,
          b.email || null,
          (b.status === 'inactive' || b.status === 'suspended') ? b.status : 'active',
          b.name || null,
          b.address || null,
        ]
      );
      const userId = u.insertId;

      const online = !!b.online;
      const kyc = ['approved','rejected','pending'].includes(b.kyc_status) ? b.kyc_status : 'pending';

      // new riders always start with approval pending unless you explicitly pass approved
      const approval = ['approved','rejected','pending'].includes(b.approval_status) ? b.approval_status : 'pending';

      await conn.execute(
        `INSERT INTO delivery_boys
          (user_id, vehicle, vehicle_number, license_no, aadhaar,
           bank_name, account_no, ifsc, upi, area,
           online_status, kyc_status, approval_status, approved_at, created_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          userId,
          b.vehicle || 'Bike',
          b.vehicle_no || null,
          b.license_no || null,
          b.aadhaar || null,
          b.bank_name || null,
          b.account_no || null,
          b.ifsc || null,
          b.upi || null,
          b.area || null,
          online ? 'online' : 'offline',
          kyc,
          approval,
          approval === 'approved' ? now() : null,
        ]
      );

      await conn.commit();
      return res.status(201).json({ id: userId });
    } catch (err) {
      await conn.rollback();
      if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Duplicate constraint failed' });
      }
      return next(err);
    } finally {
      conn.release();
    }
  } catch (e) {
    return next(e);
  }
});

// ---------- LIST RIDERS ----------
// GET /api/admin/riders?page=1&pageSize=20&q=term&status=active|inactive&kyc=pending|approved|rejected&approval=pending|approved|rejected&online=1|0
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const q = String(req.query.q || '').trim();

    const status = req.query.status;   // users.status
    const kyc = req.query.kyc;         // delivery_boys.kyc_status
    const approval = req.query.approval; // delivery_boys.approval_status
    const online = req.query.online;   // '1'|'0'

    const where = [`u.role='rider'`];
    const params = [];

    if (q) {
      where.push(`(u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR db.area LIKE ? OR db.vehicle_number LIKE ? OR db.license_no LIKE ?)`);
      params.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`);
    }
    if (status && ['active','inactive','suspended'].includes(status)) {
      where.push('u.status=?'); params.push(status);
    }
    if (kyc && ['pending','approved','rejected'].includes(kyc)) {
      where.push('db.kyc_status=?'); params.push(kyc);
    }
    if (approval && ['pending','approved','rejected'].includes(approval)) {
      where.push('db.approval_status=?'); params.push(approval);
    }
    if (online === '1' || online === '0') {
      where.push('db.online_status=?'); params.push(online === '1' ? 'online' : 'offline');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN delivery_boys db ON db.user_id = u.id
       ${whereSql}`, params
    );

    const [rows] = await pool.query(
      `SELECT
          u.id               AS user_id,
          u.name,
          u.phone,
          u.email,
          u.address,
          u.status           AS user_status,
          u.created_at       AS user_created_at,
          db.id              AS rider_id,
          db.vehicle,
          db.vehicle_number,
          db.license_no,
          db.aadhaar,
          db.bank_name,
          db.account_no,
          db.ifsc,
          db.upi,
          db.area,
          db.online_status,
          db.kyc_status,
          db.approval_status,
          db.approved_at,
          db.created_at      AS rider_created_at
       FROM users u
       LEFT JOIN delivery_boys db ON db.user_id = u.id
       ${whereSql}
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ page, pageSize, total: Number(total) || 0, rows });
  } catch (e) { next(e); }
});

// ---------- GET ONE ----------
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT
          u.id AS user_id, u.name, u.phone, u.email, u.address, u.status AS user_status,
          db.id AS rider_id, db.vehicle, db.vehicle_number, db.license_no, db.aadhaar,
          db.bank_name, db.account_no, db.ifsc, db.upi, db.area,
          db.online_status, db.kyc_status, db.approval_status, db.approved_at
       FROM users u LEFT JOIN delivery_boys db ON db.user_id=u.id
       WHERE u.id=? AND u.role='rider' LIMIT 1`, [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ---------- UPDATE PROFILE (non-bank) ----------
router.patch('/:id/profile', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // users
      await conn.execute(
        `UPDATE users SET name=COALESCE(?, name), address=COALESCE(?, address), updated_at=NOW()
         WHERE id=? AND role='rider'`,
        [b.name ?? null, b.address ?? null, id]
      );

      // delivery_boys
      await conn.execute(
        `UPDATE delivery_boys
         SET vehicle=COALESCE(?, vehicle),
             vehicle_number=COALESCE(?, vehicle_number),
             license_no=COALESCE(?, license_no),
             aadhaar=COALESCE(?, aadhaar),
             area=COALESCE(?, area),
             updated_at=NOW()
         WHERE user_id=?`,
        [b.vehicle ?? null, b.vehicle_no ?? null, b.license_no ?? null, b.aadhaar ?? null, b.area ?? null, id]
      );

      await conn.commit();
      res.json({ ok: true });
    } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
  } catch (e) { next(e); }
});

// ---------- UPDATE BANK ----------
router.patch('/:id/bank', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    await pool.execute(
      `UPDATE delivery_boys
       SET bank_name=COALESCE(?, bank_name),
           account_no=COALESCE(?, account_no),
           ifsc=COALESCE(?, ifsc),
           upi=COALESCE(?, upi),
           updated_at=NOW()
       WHERE user_id=?`,
      [b.bank_name ?? null, b.account_no ?? null, b.ifsc ?? null, b.upi ?? null, id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- TOGGLE ONLINE ----------
router.patch('/:id/online', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const online = !!(req.body?.online);
    await pool.execute(
      `UPDATE delivery_boys SET online_status=?, updated_at=NOW() WHERE user_id=?`,
      [online ? 'online' : 'offline', id]
    );
    res.json({ ok: true, online });
  } catch (e) { next(e); }
});

// ---------- KYC STATUS ----------
router.patch('/:id/kyc', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const kyc = String(req.body?.kyc_status || '').toLowerCase();
    if (!['pending','approved','rejected'].includes(kyc)) {
      return res.status(400).json({ ok: false, message: 'kyc_status must be pending|approved|rejected' });
    }
    await pool.execute(
      `UPDATE delivery_boys SET kyc_status=?, updated_at=NOW() WHERE user_id=?`,
      [kyc, id]
    );
    res.json({ ok: true, kyc_status: kyc });
  } catch (e) { next(e); }
});

// ---------- APPROVAL (gate for orders) ----------
router.patch('/:id/approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const approval = String(req.body?.approval_status || '').toLowerCase();
    if (!['pending','approved','rejected'].includes(approval)) {
      return res.status(400).json({ ok: false, message: 'approval_status must be pending|approved|rejected' });
    }
    await pool.execute(
      `UPDATE delivery_boys
       SET approval_status=?, approved_at=?, rejected_reason=?
       WHERE user_id=?`,
      [
        approval,
        approval === 'approved' ? now() : null,
        approval === 'rejected' ? (req.body?.reason || null) : null,
        id
      ]
    );
    res.json({ ok: true, approval_status: approval });
  } catch (e) { next(e); }
});

// ---------- ACTIVATE/INACTIVATE USER ----------
router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toLowerCase();
    if (!['active','inactive','suspended'].includes(status)) {
      return res.status(400).json({ ok: false, message: 'status must be active|inactive|suspended' });
    }
    await pool.execute(
      `UPDATE users SET status=?, updated_at=NOW() WHERE id=? AND role='rider'`,
      [status, id]
    );
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

// ---------- DELETE (soft: inactivate + offline + pending) ----------
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`UPDATE users SET status='inactive', updated_at=NOW() WHERE id=? AND role='rider'`, [id]);
      await conn.execute(`UPDATE delivery_boys SET online_status='offline', approval_status='pending', updated_at=NOW() WHERE user_id=?`, [id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
  } catch (e) { next(e); }
});

module.exports = router;
