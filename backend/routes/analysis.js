const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { appError, ErrorCodes } = require('../utils/errors');
const { createScanSchema, compareScanSchema } = require('../validators/schemas');
const { paginate } = require('../utils/pagination');
const { awardXP, checkAndAwardAchievements, updateChallengeProgress } = require('../services/gamificationEngine');
const { uploadLimiter } = require('../middleware/rateLimiter');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) && allowedMime.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only jpg, png, and webp files are allowed'));
  },
});

// All routes require auth
router.use(auth);

// POST /upload
router.post('/upload', uploadLimiter, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw appError(ErrorCodes.VALIDATION_ERROR, 'No image file provided');

    const imageUrl = `/uploads/${req.file.filename}`;
    // Use same file as thumbnail for simplicity
    const thumbnailUrl = imageUrl;

    res.status(201).json({ imageUrl, thumbnailUrl });
  } catch (err) {
    next(err);
  }
});

// POST /scans
router.post('/scans', validate(createScanSchema), async (req, res, next) => {
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const { image_url, thumbnail_url, height_at_scan, weight_at_scan, bmi_at_scan, goal_at_scan, gender_at_scan, results } = req.body;

    const scanResult = await client.query(
      `INSERT INTO analysis_scans (user_id, image_url, thumbnail_url, height_at_scan, weight_at_scan, bmi_at_scan, goal_at_scan, gender_at_scan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, image_url, thumbnail_url, height_at_scan, weight_at_scan, bmi_at_scan, goal_at_scan, gender_at_scan]
    );
    const scan = scanResult.rows[0];

    // Insert results
    const r = results;
    await client.query(
      `INSERT INTO analysis_results (scan_id, fitness_index, overall_grade, visual_age, symmetry_score,
        body_comp_score, body_comp_category, body_type, lean_mass_estimate, muscle_tone_score,
        muscle_upper_body, muscle_core, muscle_lower_body, posture_score, posture_shoulder,
        posture_spine, posture_hip, zone_shoulders, zone_chest, zone_core, zone_legs,
        bmi, bmi_category, raw_landmarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [scan.id, r.fitness_index, r.overall_grade, r.visual_age, r.symmetry_score,
       r.body_comp_score, r.body_comp_category, r.body_type, r.lean_mass_estimate, r.muscle_tone_score,
       r.muscle_upper_body, r.muscle_core, r.muscle_lower_body, r.posture_score, r.posture_shoulder,
       r.posture_spine, r.posture_hip, r.zone_shoulders, r.zone_chest, r.zone_core, r.zone_legs,
       r.bmi, r.bmi_category, r.raw_landmarks ? JSON.stringify(r.raw_landmarks) : null]
    );

    // Gamification: increment analyses, award XP
    await client.query(
      'UPDATE user_gamification SET total_analyses = total_analyses + 1 WHERE user_id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');

    // Post-transaction gamification
    await awardXP(req.user.id, 30);
    await updateChallengeProgress(req.user.id, 'total_analyses', 1);
    const newAchievements = await checkAndAwardAchievements(req.user.id);

    res.status(201).json({ scan, newAchievements });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

// GET /scans
router.get('/scans', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await paginate(
      `SELECT s.*, row_to_json(r.*) AS results
       FROM analysis_scans s
       LEFT JOIN analysis_results r ON r.scan_id = s.id
       WHERE s.user_id = $1
       ORDER BY s.scan_date DESC`,
      `SELECT COUNT(*) FROM analysis_scans WHERE user_id = $1`,
      [req.user.id],
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /scans/:id
router.get('/scans/:id', async (req, res, next) => {
  try {
    const scan = (await db.query(
      `SELECT s.*, row_to_json(r.*) AS results
       FROM analysis_scans s
       LEFT JOIN analysis_results r ON r.scan_id = s.id
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    )).rows[0];

    if (!scan) throw appError(ErrorCodes.NOT_FOUND, 'Scan not found');
    res.json(scan);
  } catch (err) {
    next(err);
  }
});

// GET /scans/:id/results
router.get('/scans/:id/results', async (req, res, next) => {
  try {
    // Verify ownership
    const scan = (await db.query(
      'SELECT id FROM analysis_scans WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )).rows[0];
    if (!scan) throw appError(ErrorCodes.NOT_FOUND, 'Scan not found');

    const results = (await db.query(
      'SELECT * FROM analysis_results WHERE scan_id = $1',
      [req.params.id]
    )).rows[0];

    if (!results) throw appError(ErrorCodes.NOT_FOUND, 'Results not found');
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// DELETE /scans/:id
router.delete('/scans/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM analysis_scans WHERE id = $1 AND user_id = $2 RETURNING id, image_url, thumbnail_url',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Scan not found');

    // Clean up uploaded images from disk
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const scan = result.rows[0];
    [scan.image_url, scan.thumbnail_url].forEach(url => {
      if (url) {
        const filePath = path.join(uploadsDir, path.basename(url));
        require('fs').unlink(filePath, () => {}); // best-effort
      }
    });

    res.json({ message: 'Scan deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /compare
router.post('/compare', validate(compareScanSchema), async (req, res, next) => {
  try {
    const { scan_id_1, scan_id_2 } = req.body;

    const scans = await db.query(
      `SELECT s.*, row_to_json(r.*) AS results
       FROM analysis_scans s
       LEFT JOIN analysis_results r ON r.scan_id = s.id
       WHERE s.id = ANY($1) AND s.user_id = $2
       ORDER BY s.scan_date ASC`,
      [[scan_id_1, scan_id_2], req.user.id]
    );

    if (scans.rows.length !== 2) throw appError(ErrorCodes.NOT_FOUND, 'One or both scans not found');

    const [scan1, scan2] = scans.rows;
    const r1 = scan1.results || {};
    const r2 = scan2.results || {};

    // Compute deltas for numeric fields
    const numericFields = ['body_comp_score', 'muscle_tone_score', 'posture_score', 'symmetry_score', 'visual_age', 'bmi'];
    const deltas = {};
    for (const f of numericFields) {
      if (r1[f] != null && r2[f] != null) {
        deltas[f] = r2[f] - r1[f];
      }
    }

    // Update first_compare_done
    await db.query(
      'UPDATE user_gamification SET first_compare_done = true WHERE user_id = $1',
      [req.user.id]
    );
    const newAchievements = await checkAndAwardAchievements(req.user.id);

    res.json({ scan1, scan2, deltas, newAchievements });
  } catch (err) {
    next(err);
  }
});

// GET /export/:id
router.get('/export/:id', async (req, res, next) => {
  try {
    const scan = (await db.query(
      `SELECT s.*, row_to_json(r.*) AS results
       FROM analysis_scans s
       LEFT JOIN analysis_results r ON r.scan_id = s.id
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    )).rows[0];

    if (!scan) throw appError(ErrorCodes.NOT_FOUND, 'Scan not found');

    res.json({
      exportedAt: new Date().toISOString(),
      scan,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
