// backend/server.js — Food App API (updated mount for menu routes)

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const pool = require('./db');

console.log('🚀 Starting Food API server...');
console.log('🌍 NODE_ENV:', process.env.NODE_ENV || '(not set)');
console.log('🗝️ JWT_SECRET set:', !!process.env.JWT_SECRET);

// ---- ROUTE IMPORTS ----
const loginRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const adminUsersRoutes = require('./routes/adminusers.routes');
const ridersRoutes = require('./routes/adminbikers.routes');
const merchantsRoutes = require('./routes/adminmerchant.routes');
const settingsRoutes = require('./routes/settings.routes');

const merchantDashRoutes = require('./routes/merchnathome.routes');
const merchantMenuRoutes = require('./routes/merchantmenu.routes');
const merchantOperationsRoutes = require('./routes/merchant_operations.routes');
const merchantProfileUploadRoutes = require('./routes/merchant_profile.routes');

const customerRoutes = require('./routes/customer.routes');
const deliveryBoyHomeRoutes = require('./routes/deliveryboyhome.routes');

// 🔥 NEW: Customer Address Route
const customerAddressRoutes = require('./routes/customer_address.routes');
const customerProfileRoutes = require('./routes/customerprofile.routes');
const customerMenuRoutes = require('./routes/customerMenu.routes');
const customerCartRoutes = require('./routes/customer_cart.routes');



// 🔥 Promotions and Admin Profile Routes
const adminProfileRoutes = require('./routes/adminProfile.routes');
const promotionRoutes = require('./routes/admin_promotion.routes');

const app = express();

// ---------- MIDDLEWARE ----------
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '5mb' }));

app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(morgan('dev'));

// Serve uploads (profile images, promo media)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- DB CHECK ----------
(async () => {
  try {
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const [[ts]] = await pool.query('SELECT NOW() AS now');
    console.log(`✅ MySQL OK | DB: ${dbRow.db} | ${ts.now}`);
  } catch (e) {
    console.error('❌ DB connection FAILED:', e);
  }
})();

// ---------- ROUTES ----------

// Auth (Login + OTP)
app.use('/api/auth', loginRoutes);

// Admin Profile Route (MUST be above /admin)
app.use('/api/profile', adminProfileRoutes);

// Admin
app.use('/api/admin', adminRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/riders', ridersRoutes);
app.use('/api/admin/merchants', merchantsRoutes);
app.use('/api/admin/promotions', promotionRoutes);

// Merchant
app.use('/api/merchant', merchantProfileUploadRoutes);
app.use('/api/merchant', merchantOperationsRoutes);
app.use('/api/merchant', merchantDashRoutes);
app.use('/api/merchant', merchantMenuRoutes);

// Customer
app.use('/api/customer', customerRoutes);
app.use('/api/customer', customerAddressRoutes); // ⭐ NEW
app.use('/api/customer', customerProfileRoutes);
app.use('/api/customer', customerMenuRoutes);
app.use('/api/customer', customerCartRoutes); 

// Delivery Boy
app.use('/api/delivery', deliveryBoyHomeRoutes);

// System settings
app.use('/api', settingsRoutes);

// 404 fallback
app.use((req, res) => {
  console.warn('404 Not found:', req.method, req.originalUrl);
  res.status(404).json({ ok: false, message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ ok: false, message: 'Server error' });
});

// Start Server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 API server running at http://${HOST}:${PORT}`);
});
