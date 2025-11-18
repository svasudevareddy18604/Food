// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  const authHeader = req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '')?.trim();

  if (!token) {
    return res.status(401).json({ ok: false, message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach decoded payload (e.g., id, role)
    next();
  } catch (err) {
    console.error('JWT verify failed:', err.message);
    res.status(401).json({ ok: false, message: 'Invalid or expired token' });
  }
};
