const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { wearableSessionSchema } = require('../validators/schemas');

router.use(auth);

// POST /api/wearable/session
router.post('/session', validate(wearableSessionSchema), async (req, res, next) => {
  try {
    const { steps = 0, hr_avg, hr_readings, calories, active_secs = 0, session_date } = req.body;
    const dateVal = session_date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO wearable_sessions (user_id, session_date, steps, hr_avg, hr_readings, calories, active_secs)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, session_date AS date, steps, hr_avg, calories, active_secs`,
      [req.user.id, dateVal, steps, hr_avg || null,
       hr_readings ? JSON.stringify(hr_readings) : null,
       calories || null, active_secs]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/wearable/sessions?limit=30
router.get('/sessions', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const result = await db.query(
      `SELECT id, session_date AS date, steps, hr_avg, calories, active_secs, created_at
       FROM wearable_sessions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/wearable/today
router.get('/today', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT COALESCE(SUM(steps), 0)::int            AS total_steps,
              ROUND(AVG(NULLIF(hr_avg, 0)))::int       AS avg_hr,
              ROUND(COALESCE(SUM(calories), 0))::int   AS total_calories,
              COALESCE(SUM(active_secs), 0)::int       AS total_active_secs
       FROM wearable_sessions
       WHERE user_id = $1 AND session_date = CURRENT_DATE`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
