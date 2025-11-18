// backend/routes/settings.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

/** ---------- helpers ---------- */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function tableExists(name) {
  const rows = await q(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name=? LIMIT 1`, [name]
  );
  return rows.length > 0;
}
async function ensureTable() {
  const has = await tableExists('app_settings');
  if (has) return;

  await q(`
    CREATE TABLE app_settings (
      id INT PRIMARY KEY,
      zones JSON NULL,
      operating_hours VARCHAR(32) NULL,
      base_delivery_fee DECIMAL(10,2) DEFAULT 0,
      per_km_fee DECIMAL(10,2) DEFAULT 0,
      cancellation_mins INT DEFAULT 5,

      force_update_min_version VARCHAR(20) NULL,
      maintenance TINYINT(1) DEFAULT 0,
      announcement VARCHAR(255) NULL,

      merchant_commission_pct DECIMAL(5,2) DEFAULT 0,
      rider_commission_pct DECIMAL(5,2) DEFAULT 0,
      payout_cycle ENUM('weekly','monthly') DEFAULT 'weekly',
      gst_number VARCHAR(32) NULL,
      fssai_number VARCHAR(32) NULL,
      razorpay_key_id VARCHAR(64) NULL,

      two_factor TINYINT(1) DEFAULT 0,
      api_base VARCHAR(128) NULL,

      support_phone VARCHAR(32) NULL,
      support_email VARCHAR(128) NULL,
      sms_provider VARCHAR(64) NULL,

      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await q(`
    INSERT INTO app_settings
      (id, zones, operating_hours, base_delivery_fee, per_km_fee, cancellation_mins,
       force_update_min_version, maintenance, announcement,
       merchant_commission_pct, rider_commission_pct, payout_cycle,
       gst_number, fssai_number, razorpay_key_id,
       two_factor, api_base,
       support_phone, support_email, sms_provider)
    VALUES
      (1, JSON_ARRAY('HSR','BTM'), '09:00–22:00', 25.00, 5.00, 5,
       '1.0.0', 0, NULL,
       10.00, 80.00, 'weekly',
       NULL, NULL, NULL,
       0, NULL,
       NULL, NULL, NULL)
  `);
}

function asBool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  return 0;
}
function cleanString(v) {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function only(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

async function readSettings() {
  await ensureTable();
  const rows = await q(`SELECT * FROM app_settings WHERE id=1 LIMIT 1`);
  const r = rows[0] || {};
  return {
    zones: tryParseJson(r.zones) ?? [],
    operating_hours: r.operating_hours ?? '09:00–22:00',
    base_delivery_fee: Number(r.base_delivery_fee ?? 0),
    per_km_fee: Number(r.per_km_fee ?? 0),
    cancellation_mins: Number(r.cancellation_mins ?? 5),

    force_update_min_version: r.force_update_min_version ?? '1.0.0',
    maintenance: !!r.maintenance,
    announcement: r.announcement ?? null,

    merchant_commission_pct: Number(r.merchant_commission_pct ?? 0),
    rider_commission_pct: Number(r.rider_commission_pct ?? 0),
    payout_cycle: r.payout_cycle ?? 'weekly',
    gst_number: r.gst_number ?? null,
    fssai_number: r.fssai_number ?? null,
    razorpay_key_id: r.razorpay_key_id ?? null,

    two_factor: !!r.two_factor,
    api_base: r.api_base ?? null,

    support_phone: r.support_phone ?? null,
    support_email: r.support_email ?? null,
    sms_provider: r.sms_provider ?? null,

    updated_at: r.updated_at ?? null,
  };
}

function tryParseJson(v) {
  if (!v) return null;
  try {
    if (typeof v === 'string') return JSON.parse(v);
    return v;
  } catch { return null; }
}

async function writeSettings(payload) {
  await ensureTable();

  // Normalize inputs
  const zonesArr = Array.isArray(payload.zones)
    ? payload.zones.map(x => String(x).trim()).filter(Boolean)
    : (typeof payload.zones === 'string'
        ? payload.zones.split(',').map(s => s.trim()).filter(Boolean)
        : []);

  const allowed = [
    'operating_hours', 'base_delivery_fee', 'per_km_fee', 'cancellation_mins',
    'force_update_min_version', 'maintenance', 'announcement',
    'merchant_commission_pct', 'rider_commission_pct', 'payout_cycle',
    'gst_number', 'fssai_number', 'razorpay_key_id',
    'two_factor', 'api_base',
    'support_phone', 'support_email', 'sms_provider'
  ];
  const p = only(payload, allowed);

  const sql = `
    UPDATE app_settings SET
      zones = ?,
      operating_hours = ?,
      base_delivery_fee = ?,
      per_km_fee = ?,
      cancellation_mins = ?,

      force_update_min_version = ?,
      maintenance = ?,
      announcement = ?,

      merchant_commission_pct = ?,
      rider_commission_pct = ?,
      payout_cycle = ?,
      gst_number = ?,
      fssai_number = ?,
      razorpay_key_id = ?,

      two_factor = ?,
      api_base = ?,

      support_phone = ?,
      support_email = ?,
      sms_provider = ?
    WHERE id = 1
  `;
  const params = [
    JSON.stringify(zonesArr),
    cleanString(p.operating_hours),
    toNumber(p.base_delivery_fee, 0),
    toNumber(p.per_km_fee, 0),
    toInt(p.cancellation_mins, 5),

    cleanString(p.force_update_min_version),
    asBool(p.maintenance),
    cleanString(p.announcement),

    toNumber(p.merchant_commission_pct, 0),
    toNumber(p.rider_commission_pct, 0),
    (p.payout_cycle === 'monthly' ? 'monthly' : 'weekly'),
    cleanString(p.gst_number),
    cleanString(p.fssai_number),
    cleanString(p.razorpay_key_id),

    asBool(p.two_factor),
    cleanString(p.api_base),

    cleanString(p.support_phone),
    cleanString(p.support_email),
    cleanString(p.sms_provider),
  ];

  await q(sql, params);
}

/** ---------- routes ---------- */

// GET /api/admin/settings
router.get('/admin/settings', async (req, res) => {
  try {
    const data = await readSettings();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[settings.get]', err);
    res.status(500).json({ ok: false, error: 'Failed to read settings', details: err.message });
  }
});

// PATCH /api/admin/settings
router.patch('/admin/settings', async (req, res) => {
  try {
    const body = req.body || {};
    await writeSettings(body);
    const data = await readSettings();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[settings.patch]', err);
    res.status(500).json({ ok: false, error: 'Failed to update settings', details: err.message });
  }
});

/** public fallbacks (optional) */
// GET /api/settings
router.get('/settings', async (req, res) => {
  try {
    const data = await readSettings();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[settings.public.get]', err);
    res.status(500).json({ ok: false, error: 'Failed to read settings', details: err.message });
  }
});

module.exports = router;
