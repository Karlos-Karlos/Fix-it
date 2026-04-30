const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const { appError, ErrorCodes } = require('../utils/errors');

// All tracking routes require auth
router.use(auth);

// ── SLEEP LOG ─────────────────────────────────────────────────────────────────

// POST /tracking/sleep  { hours, quality, sleep_date? }
router.post('/sleep', async (req, res, next) => {
  try {
    const { hours, quality = 'good', sleep_date } = req.body;
    if (!hours || hours <= 0 || hours > 24) throw appError(ErrorCodes.VALIDATION_ERROR, 'hours must be between 0 and 24');
    const validQualities = ['poor', 'fair', 'good', 'excellent'];
    if (!validQualities.includes(quality)) throw appError(ErrorCodes.VALIDATION_ERROR, 'quality must be poor, fair, good, or excellent');
    const dateVal = sleep_date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO sleep_logs (user_id, sleep_date, hours, quality)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, sleep_date) DO UPDATE
         SET hours = EXCLUDED.hours, quality = EXCLUDED.quality, updated_at = NOW()
       RETURNING *`,
      [req.user.id, dateVal, hours, quality]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/sleep?days=90
router.get('/sleep', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const result = await db.query(
      `SELECT sleep_date AS date, hours, quality FROM sleep_logs
       WHERE user_id = $1 AND sleep_date >= CURRENT_DATE - $2::int
       ORDER BY sleep_date DESC`,
      [req.user.id, days]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── HYDRATION LOG ─────────────────────────────────────────────────────────────

// POST /tracking/hydration  { glasses_drunk, log_date? }
router.post('/hydration', async (req, res, next) => {
  try {
    const { glasses_drunk, log_date } = req.body;
    if (glasses_drunk === undefined || glasses_drunk === null) throw appError(ErrorCodes.VALIDATION_ERROR, 'glasses_drunk required');
    const dateVal = log_date || new Date().toISOString().split('T')[0];
    const parsed = parseInt(glasses_drunk, 10);
    if (!Number.isFinite(parsed)) throw appError(ErrorCodes.VALIDATION_ERROR, 'glasses_drunk must be a number');
    if (parsed < 0 || parsed > 20) throw appError(ErrorCodes.VALIDATION_ERROR, 'glasses_drunk must be between 0 and 20');
    const n = parsed;

    const result = await db.query(
      `INSERT INTO hydration_logs (user_id, log_date, glasses_drunk)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, log_date) DO UPDATE
         SET glasses_drunk = EXCLUDED.glasses_drunk, updated_at = NOW()
       RETURNING *`,
      [req.user.id, dateVal, n]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/hydration/history?days=30
router.get('/hydration/history', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const result = await db.query(
      `SELECT log_date AS date, glasses_drunk FROM hydration_logs
       WHERE user_id = $1 AND log_date >= CURRENT_DATE - $2::int
       ORDER BY log_date DESC`,
      [req.user.id, days]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /tracking/hydration?date=YYYY-MM-DD
router.get('/hydration', async (req, res, next) => {
  try {
    const dateVal = req.query.date || new Date().toISOString().split('T')[0];
    const result = await db.query(
      'SELECT log_date AS date, glasses_drunk FROM hydration_logs WHERE user_id = $1 AND log_date = $2',
      [req.user.id, dateVal]
    );
    res.json(result.rows[0] || { date: dateVal, glasses_drunk: 0 });
  } catch (err) { next(err); }
});

// ── GOAL WEIGHT ───────────────────────────────────────────────────────────────

// PUT /tracking/goal-weight  { goal_kg, start_kg? }
router.put('/goal-weight', async (req, res, next) => {
  try {
    const { goal_kg, start_kg } = req.body;
    if (!goal_kg || goal_kg <= 0) throw appError(ErrorCodes.VALIDATION_ERROR, 'goal_kg required');

    const result = await db.query(
      `INSERT INTO goal_weight (user_id, goal_kg, start_kg)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET goal_kg = EXCLUDED.goal_kg,
             start_kg = COALESCE(EXCLUDED.start_kg, goal_weight.start_kg),
             updated_at = NOW()
       RETURNING *`,
      [req.user.id, goal_kg, start_kg || null]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/goal-weight
router.get('/goal-weight', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT goal_kg, start_kg, set_at FROM goal_weight WHERE user_id = $1',
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) { next(err); }
});

// ── WEIGHT LOG ────────────────────────────────────────────────────────────────

// POST /tracking/weight-log  { weight_kg, log_date? }
router.post('/weight-log', async (req, res, next) => {
  try {
    const { weight_kg, log_date } = req.body;
    if (!weight_kg || weight_kg <= 0) throw appError(ErrorCodes.VALIDATION_ERROR, 'weight_kg required');
    const dateVal = log_date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO weight_log (user_id, log_date, weight_kg)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, log_date) DO UPDATE
         SET weight_kg = EXCLUDED.weight_kg, updated_at = NOW()
       RETURNING *`,
      [req.user.id, dateVal, weight_kg]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/weight-log?days=90
router.get('/weight-log', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const result = await db.query(
      `SELECT log_date AS date, weight_kg AS weight FROM weight_log
       WHERE user_id = $1 AND log_date >= CURRENT_DATE - $2::int
       ORDER BY log_date DESC`,
      [req.user.id, days]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── MEASUREMENT LOG ───────────────────────────────────────────────────────────

// POST /tracking/measurements  { chest?, waist?, hips?, arms?, log_date? }
router.post('/measurements', async (req, res, next) => {
  try {
    const { chest, waist, hips, arms, log_date } = req.body;
    if (!chest && !waist && !hips && !arms) throw appError(ErrorCodes.VALIDATION_ERROR, 'At least one measurement required');
    const dateVal = log_date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO measurement_logs (user_id, log_date, chest, waist, hips, arms)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, log_date) DO UPDATE
         SET chest = COALESCE(EXCLUDED.chest, measurement_logs.chest),
             waist = COALESCE(EXCLUDED.waist, measurement_logs.waist),
             hips  = COALESCE(EXCLUDED.hips,  measurement_logs.hips),
             arms  = COALESCE(EXCLUDED.arms,  measurement_logs.arms),
             updated_at = NOW()
       RETURNING *`,
      [req.user.id, dateVal, chest || null, waist || null, hips || null, arms || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/measurements?days=90
router.get('/measurements', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const result = await db.query(
      `SELECT log_date AS date, chest, waist, hips, arms FROM measurement_logs
       WHERE user_id = $1 AND log_date >= CURRENT_DATE - $2::int
       ORDER BY log_date DESC`,
      [req.user.id, days]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── LIFT LOG (Personal Records) ───────────────────────────────────────────────

// POST /tracking/lifts  { exercise_name, weight_kg, reps, e1rm?, log_date? }
router.post('/lifts', async (req, res, next) => {
  try {
    const { exercise_name, weight_kg, reps, e1rm, log_date } = req.body;
    if (!exercise_name || exercise_name.length > 100) throw appError(ErrorCodes.VALIDATION_ERROR, 'exercise_name required and must be ≤100 characters');
    if (!weight_kg || weight_kg <= 0) throw appError(ErrorCodes.VALIDATION_ERROR, 'weight_kg required');
    if (!reps || reps <= 0) throw appError(ErrorCodes.VALIDATION_ERROR, 'reps required');
    const dateVal = log_date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO lift_log (user_id, exercise_name, log_date, weight_kg, reps, e1rm)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, exercise_name, log_date) DO UPDATE
         SET weight_kg = EXCLUDED.weight_kg, reps = EXCLUDED.reps,
             e1rm = EXCLUDED.e1rm, updated_at = NOW()
       RETURNING *`,
      [req.user.id, exercise_name, dateVal, weight_kg, reps, e1rm || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /tracking/lifts  — returns all entries newest-first per exercise
router.get('/lifts', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT exercise_name, log_date AS date, weight_kg AS weight, reps, e1rm
       FROM lift_log WHERE user_id = $1
       ORDER BY exercise_name, log_date DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
