// routes/merchant_profile.routes.js

const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../db");

const router = express.Router();

/** Extract user ID from JWT */
function getUserIdFromReq(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;

  try {
    const token = auth.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.sub || payload.user_id || payload.id;
  } catch {
    return null;
  }
}

/** Ensure BASE_URL */
function buildImageUrl(relativePath) {
  const base = process.env.BASE_URL?.trim();
  if (base && base.startsWith("http")) return base + relativePath;

  // fallback based on LAN
  return `http://192.168.1.102:3000${relativePath}`;
}

/** Setup Multer for Image Uploads */
const uploadDir = path.join(__dirname, "../uploads/profile_images");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, `merchant_${Date.now()}${path.extname(file.originalname)}`),
});

const upload = multer({ storage });

/** GET /api/merchant/profile */
router.get("/profile", async (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const [[data]] = await pool.query(
      `
      SELECT store_name, category, owner_name, phone, email, address, city, gst, 
             merchant_code, is_open, status, profile_image
      FROM merchants
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!data) {
      return res
        .status(404)
        .json({ ok: false, message: "Merchant profile not found" });
    }

    if (data.profile_image) {
      data.profile_image = buildImageUrl(data.profile_image);
    }

    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ Fetch profile failed:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/** POST /api/merchant/profile/image-upload */
router.post(
  "/profile/image-upload",
  upload.single("image"),
  async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, message: "No image provided" });
    }

    const filePath = `/uploads/profile_images/${req.file.filename}`;

    try {
      await pool.query(
        `UPDATE merchants SET profile_image = ? WHERE user_id = ?`,
        [filePath, userId]
      );

      const [[merchant]] = await pool.query(
        `SELECT store_name, phone, is_open, profile_image 
         FROM merchants WHERE user_id = ? LIMIT 1`,
        [userId]
      );

      res.json({
        ok: true,
        merchant: {
          ...merchant,
          profile_image: buildImageUrl(filePath),
        },
      });
    } catch (err) {
      console.error("❌ Image upload failed:", err);
      res.status(500).json({ ok: false, message: "Server error" });
    }
  }
);

module.exports = router;
