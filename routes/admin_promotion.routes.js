const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { body, validationResult } = require("express-validator");
const db = require("../db"); // correct path

// Set up multer for media upload
const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, "uploads/promotions/");
  },
  filename: (_, file, cb) => {
    cb(null, `promo_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const filetypes = /jpeg|jpg|png|mp4|webm/;
    const ext = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) return cb(null, true);
    cb(new Error("Only image/video files allowed."));
  },
});

// =================== CREATE PROMOTION ===================
router.post(
  "/",
  upload.single("media"),
  [
    body("title").notEmpty(),
    body("type").isIn(["Global", "Merchant-Specific"]),
    body("start_date").isISO8601(),
    body("end_date").isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { title, subtitle, type, start_date, end_date } = req.body;
    const media_url = req.file ? `/uploads/promotions/${req.file.filename}` : null;

    if (!media_url) {
      return res.status(400).json({ error: "Media file is required." });
    }

    try {
      await db.query(
        `INSERT INTO promotions (title, subtitle, type, media_url, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, 'Active')`,
        [title, subtitle, type, media_url, start_date, end_date]
      );
      res.json({ success: true, message: "Promotion created successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  }
);

// =================== EDIT PROMOTION (PATCH) ===================
router.patch(
  "/:id",
  upload.single("media"),
  [
    // optional validation - only check if present
    body("title").optional().notEmpty(),
    body("type").optional().isIn(["Global", "Merchant-Specific"]),
    body("status").optional().isIn(["Active", "Inactive", "Expired"]),
    body("start_date").optional().isISO8601(),
    body("end_date").optional().isISO8601(),
  ],
  async (req, res) => {
    const { id } = req.params;
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { title, subtitle, type, start_date, end_date, status } = req.body;
    const media_url = req.file ? `/uploads/promotions/${req.file.filename}` : null;

    try {
      // dynamic update only the fields passed
      let updateFields = [];
      let params = [];

      if (title !== undefined) {
        updateFields.push("title = ?");
        params.push(title);
      }
      if (subtitle !== undefined) {
        updateFields.push("subtitle = ?");
        params.push(subtitle);
      }
      if (type !== undefined) {
        updateFields.push("type = ?");
        params.push(type);
      }
      if (start_date !== undefined) {
        updateFields.push("start_date = ?");
        params.push(start_date);
      }
      if (end_date !== undefined) {
        updateFields.push("end_date = ?");
        params.push(end_date);
      }
      if (status !== undefined) {
        updateFields.push("status = ?");
        params.push(status);
      }
      if (media_url) {
        updateFields.push("media_url = ?");
        params.push(media_url);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const sql = `UPDATE promotions SET ${updateFields.join(", ")} WHERE id = ?`;
      params.push(id);

      const [result] = await db.query(sql, params);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      res.json({ success: true, message: "Promotion updated successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  }
);

// =================== GET ALL PROMOTIONS ===================
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM promotions ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// =================== GET ONE PROMOTION ===================
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM promotions WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Promotion not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// =================== DELETE PROMOTION ===================
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM promotions WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Promotion not found" });
    }
    res.json({ success: true, message: "Promotion deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
