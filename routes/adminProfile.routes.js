const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const path = require("path");
const verifyToken = require("../middleware/auth");

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "uploads/profile/"),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `admin_${Date.now()}${ext}`);
  },
});

// Accept image files only
const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowed = /jpg|jpeg|png/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) return cb(null, true);
    cb(new Error("Only JPG, JPEG, or PNG files are allowed"));
  },
});

// GET Profile
router.get("/", verifyToken, async (req, res) => {
  try {
    const adminId = req.user.sub;

    const [rows] = await db.query(
      "SELECT id, name, phone, email, address, role, status, kyc_status, aadhaar, created_at, profile_image FROM users WHERE id = ? LIMIT 1",
      [adminId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Admin not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// PATCH to update profile image
router.patch("/", verifyToken, upload.single("profile_image"), async (req, res) => {
  try {
    const adminId = req.user.sub;

    if (!req.file) {
      return res.status(400).json({ error: "Profile image is required" });
    }

    const profile_image = `/uploads/profile/${req.file.filename}`;

    await db.query("UPDATE users SET profile_image = ? WHERE id = ?", [
      profile_image,
      adminId,
    ]);

    res.json({ ok: true, message: "Profile updated", profile_image });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Update failed" });
  }
});

module.exports = router;
