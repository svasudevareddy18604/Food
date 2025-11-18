// backend/routes/merchants.routes.js
const express = require('express');
const pool = require('../db');
const router = express.Router();

/** Validators */
const is10DigitPhone = (s) => /^[0-9]{10}$/.test(String(s || '').trim());
const isEmail = (s) => /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.test(String(s || '').trim());
const isGST = (s) =>
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(String(s || '').trim());
const isFSSAI = (s) => /^\d{14}$/.test(String(s || '').trim());

/** Helpers */
function safeStatus(s) {
  return s === 'inactive' ? 'inactive' : 'active';
}
function makeMerchantCode(id) {
  // e.g., RST-000123
  return `RST-${String(id).padStart(6, '0')}`;
}

/** INTERNAL: ensure a users row exists with role=merchant, return userId */
async function ensureMerchantUser(conn, { phone, email, address, status, owner_name, store_name }) {
  const _status = safeStatus(status);
  const displayName = owner_name?.trim() || store_name?.trim() || '';

  // find by phone OR email
  const [urows] = await conn.query(
    `SELECT id, role FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?) LIMIT 1`,
    [phone, email || '']
  );

  if (urows.length) {
    const userId = urows[0].id;
    // single-role design: force role to merchant and sync basics
    await conn.query(
      `UPDATE users
         SET role='merchant',
             status=?,
             name=COALESCE(?, name),
             address=COALESCE(?, address),
             updated_at=NOW()
       WHERE id=?`,
      [_status, displayName || null, address || null, userId]
    );
    return userId;
  }

  // create new user
  const [ins] = await conn.query(
    `INSERT INTO users
       (phone, email, address, role, status, kyc_status, aadhaar, name, created_at, updated_at)
     VALUES (?, ?, ?, 'merchant', ?, 'pending', NULL, ?, NOW(), NOW())`,
    [phone, email || null, address || '', _status, displayName]
  );
  return ins.insertId;
}

/** CREATE */
router.post('/', async (req, res, next) => {
  const {
    store_name,
    owner_name,
    phone,
    email,
    address,
    city,
    category,
    gst,
    fssai,
    status,
  } = req.body || {};

  try {
    if (!store_name || !owner_name || !phone || !city || !category) {
      return res
        .status(400)
        .json({ ok: false, message: 'Missing required fields' });
    }
    if (!is10DigitPhone(phone))
      return res
        .status(400)
        .json({ ok: false, message: 'Phone must be 10 digits' });
    if (email && !isEmail(email))
      return res.status(400).json({ ok: false, message: 'Invalid email' });
    if (gst && !isGST(gst))
      return res
        .status(400)
        .json({ ok: false, message: 'Invalid GSTIN format' });
    if (!fssai || !isFSSAI(fssai))
      return res.status(400).json({
        ok: false,
        message: 'Invalid FSSAI (14 digits required)',
      });

    const statusSafe = safeStatus(status);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // duplication check (merchants)
      const [dupRows] = await conn.query(
        `
        SELECT 
          SUM(phone = ?)                    AS phone_taken,
          SUM(COALESCE(email,'') = ?)       AS email_taken,
          SUM(COALESCE(gst,'') = ?)         AS gst_taken,
          SUM(COALESCE(fssai,'') = ?)       AS fssai_taken
        FROM merchants
        WHERE (phone = ? OR (email IS NOT NULL AND email = ?) 
           OR (gst IS NOT NULL AND gst = ?) OR (fssai IS NOT NULL AND fssai = ?))
        LIMIT 1;
        `,
        [phone, email || '', gst || '', fssai || '', phone, email, gst, fssai]
      );
      const dup = dupRows?.[0] || {};
      if (Number(dup.phone_taken) > 0)
        return res.status(409).json({
          ok: false,
          field: 'phone',
          message: 'Phone already exists',
        });
      if (email && Number(dup.email_taken) > 0)
        return res.status(409).json({
          ok: false,
          field: 'email',
          message: 'Email already exists',
        });
      if (gst && Number(dup.gst_taken) > 0)
        return res.status(409).json({
          ok: false,
          field: 'gst',
          message: 'GST already exists',
        });
      if (Number(dup.fssai_taken) > 0)
        return res.status(409).json({
          ok: false,
          field: 'fssai',
          message: 'FSSAI already exists',
        });

      // ensure users row with role=merchant and get userId
      const userId = await ensureMerchantUser(conn, {
        phone,
        email,
        address,
        status: statusSafe,
        owner_name,
        store_name,
      });

      // insert merchant WITH user_id
      const [r] = await conn.query(
        `
        INSERT INTO merchants
          (store_name, owner_name, phone, email, address, city, category, gst, fssai, status, approved_at, merchant_code, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        `,
        [
          String(store_name).trim(),
          String(owner_name).trim(),
          String(phone).trim(),
          email ? String(email).trim() : null,
          address ? String(address).trim() : null,
          String(city).trim(),
          String(category).trim(),
          gst ? String(gst).trim().toUpperCase() : null,
          String(fssai).trim(),
          statusSafe,
          userId,
        ]
      );

      const id = r.insertId;
      const code = makeMerchantCode(id);
      await conn.query('UPDATE merchants SET merchant_code=? WHERE id=?', [
        code,
        id,
      ]);

      await conn.commit();
      res.status(201).json({ ok: true, id, merchant_code: code, user_id: userId });
    } catch (e) {
      await conn.rollback();
      if (e && e.code === 'ER_DUP_ENTRY') {
        const msg = String(e.sqlMessage || '').toLowerCase();
        if (msg.includes('uq_merchants_phone'))
          return res.status(409).json({
            ok: false,
            field: 'phone',
            message: 'Phone already exists',
          });
        if (msg.includes('uq_merchants_email'))
          return res.status(409).json({
            ok: false,
            field: 'email',
            message: 'Email already exists',
          });
        if (msg.includes('uq_merchants_gst'))
          return res.status(409).json({
            ok: false,
            field: 'gst',
            message: 'GST already exists',
          });
        if (msg.includes('uq_merchants_fssai'))
          return res.status(409).json({
            ok: false,
            field: 'fssai',
            message: 'FSSAI already exists',
          });
      }
      next(e);
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

/** LIST */
router.get('/', async (req, res, next) => {
  try {
    const { q, city, category, status, page = 1, pageSize = 20 } = req.query;

    const limit = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limit;

    const where = [];
    const args = [];

    if (q) {
      const like = `%${q}%`;
      where.push(`(
        store_name LIKE ? OR owner_name LIKE ? OR phone LIKE ? OR 
        COALESCE(gst,'') LIKE ? OR COALESCE(fssai,'') LIKE ? OR COALESCE(email,'') LIKE ?
      )`);
      args.push(like, like, like, like, like, like);
    }
    if (city) {
      where.push('city = ?');
      args.push(String(city));
    }
    if (category) {
      where.push('category = ?');
      args.push(String(category));
    }
    if (status) {
      where.push('status = ?');
      args.push(safeStatus(status));
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await pool.query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        id, user_id, merchant_code, store_name, owner_name, phone, email, address, city, category,
        gst, fssai, status, approved_at, created_at, updated_at
      FROM merchants
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
      `,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query('SELECT FOUND_ROWS() AS total');
    const total = Number(countRows?.[0]?.total || 0);

    res.json({ ok: true, total, page: pageNum, pageSize: limit, rows });
  } catch (err) {
    next(err);
  }
});

/** GET one */
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, merchant_code, store_name, owner_name, phone, email, address, city, category,
              gst, fssai, status, approved_at, created_at, updated_at
       FROM merchants WHERE id=? LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, message: 'Not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** UPDATE full (also sync users as merchant + keep user_id linked) */
router.put('/:id', async (req, res, next) => {
  const {
    store_name,
    owner_name,
    phone,
    email,
    address,
    city,
    category,
    gst,
    fssai,
    status,
  } = req.body || {};

  try {
    if (!store_name || !owner_name || !phone || !city || !category) {
      return res
        .status(400)
        .json({ ok: false, message: 'Missing required fields' });
    }
    if (!is10DigitPhone(phone))
      return res
        .status(400)
        .json({ ok: false, message: 'Phone must be 10 digits' });
    if (email && !isEmail(email))
      return res.status(400).json({ ok: false, message: 'Invalid email' });
    if (gst && !isGST(gst))
      return res
        .status(400)
        .json({ ok: false, message: 'Invalid GSTIN format' });
    if (!fssai || !isFSSAI(fssai))
      return res.status(400).json({
        ok: false,
        message: 'Invalid FSSAI (14 digits required)',
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // ensure uniqueness except self
      const [dup] = await conn.query(
        `
        SELECT id FROM merchants
        WHERE (phone = ? OR (email IS NOT NULL AND email = ?) OR (gst IS NOT NULL AND gst = ?) OR (fssai IS NOT NULL AND fssai = ?))
          AND id <> ?
        LIMIT 1
        `,
        [phone, email, gst, fssai, req.params.id]
      );
      if (dup.length) {
        await conn.rollback();
        conn.release();
        return res.status(409).json({
          ok: false,
          message: 'Phone/Email/GST/FSSAI already used by another merchant',
        });
      }

      // upsert users as merchant and get userId
      const userId = await ensureMerchantUser(conn, {
        phone,
        email,
        address,
        status,
        owner_name,
        store_name,
      });

      // update merchant (also ensure user_id is set)
      const [r] = await conn.query(
        `
        UPDATE merchants SET
          store_name=?, owner_name=?, phone=?, email=?, address=?, city=?, category=?, gst=?, fssai=?, status=?, user_id=?
        WHERE id=?
        `,
        [
          String(store_name).trim(),
          String(owner_name).trim(),
          String(phone).trim(),
          email ? String(email).trim() : null,
          address ? String(address).trim() : null,
          String(city).trim(),
          String(category).trim(),
          gst ? String(gst).trim().toUpperCase() : null,
          String(fssai).trim(),
          safeStatus(status),
          userId,
          req.params.id,
        ]
      );

      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ ok: false, message: 'Not found' });
      }

      await conn.commit();
      res.json({ ok: true, user_id: userId });
    } catch (e) {
      await conn.rollback();
      next(e);
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

/** PATCH status (active/inactive) + sync users.status */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const s = safeStatus(req.body?.status);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [r] = await conn.query(
        'UPDATE merchants SET status=? WHERE id=?',
        [s, req.params.id]
      );
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ ok: false, message: 'Not found' });
      }

      // sync users.status by matching phone/email from this merchant
      const [mrows] = await conn.query(
        'SELECT phone, email, user_id FROM merchants WHERE id=?',
        [req.params.id]
      );
      const m = mrows?.[0];
      if (m) {
        await conn.query(
          `UPDATE users SET status=?, updated_at=NOW()
           WHERE id=? OR phone=? OR (email IS NOT NULL AND email=?)`,
          [s, m.user_id, m.phone, m.email || '']
        );
      }

      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      next(e);
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH approve (admin)
 * - approve:   approved_at = NOW()
 * - unapprove: approved_at = NULL
 * Optional: body.status -> also update merchants.status + users.status
 *
 * Body examples:
 *   { "approved": true, "status": "active" }
 *   { "approved": false, "status": "inactive" }
 */
router.patch('/:id/approve', async (req, res, next) => {
  try {
    const rawApproved = req.body?.approved;

    let approved;
    if (typeof rawApproved === 'boolean') {
      approved = rawApproved;
    } else if (typeof rawApproved === 'string') {
      approved = rawApproved.toLowerCase() !== 'false';
    } else {
      // default: backwards compatible -> treat as approve
      approved = true;
    }

    const hasStatus = typeof req.body?.status !== 'undefined';
    const s = hasStatus ? safeStatus(req.body.status) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (approved) {
        // APPROVE
        if (s) {
          const [r] = await conn.query(
            'UPDATE merchants SET approved_at=NOW(), status=? WHERE id=?',
            [s, req.params.id]
          );
          if (!r.affectedRows) {
            await conn.rollback();
            return res
              .status(404)
              .json({ ok: false, message: 'Not found' });
          }
        } else {
          const [r] = await conn.query(
            'UPDATE merchants SET approved_at=NOW() WHERE id=?',
            [req.params.id]
          );
          if (!r.affectedRows) {
            await conn.rollback();
            return res
              .status(404)
              .json({ ok: false, message: 'Not found' });
          }
        }
      } else {
        // UNAPPROVE
        if (s) {
          const [r] = await conn.query(
            'UPDATE merchants SET approved_at=NULL, status=? WHERE id=?',
            [s, req.params.id]
          );
          if (!r.affectedRows) {
            await conn.rollback();
            return res
              .status(404)
              .json({ ok: false, message: 'Not found' });
          }
        } else {
          const [r] = await conn.query(
            'UPDATE merchants SET approved_at=NULL WHERE id=?',
            [req.params.id]
          );
          if (!r.affectedRows) {
            await conn.rollback();
            return res
              .status(404)
              .json({ ok: false, message: 'Not found' });
          }
        }
      }

      // sync users.status if status provided
      if (s) {
        const [mrows] = await conn.query(
          'SELECT phone, email, user_id FROM merchants WHERE id=?',
          [req.params.id]
        );
        const m = mrows?.[0];
        if (m) {
          await conn.query(
            `UPDATE users SET status=?, updated_at=NOW()
             WHERE id=? OR phone=? OR (email IS NOT NULL AND email=?)`,
            [s, m.user_id, m.phone, m.email || '']
          );
        }
      }

      await conn.commit();
      res.json({ ok: true, approved });
    } catch (e) {
      await conn.rollback();
      next(e);
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
