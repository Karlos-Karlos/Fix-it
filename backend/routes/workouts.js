const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { appError, ErrorCodes } = require('../utils/errors');
const { generateWorkoutSchema, saveWorkoutPlanSchema, updateWorkoutPlanSchema, logWorkoutSessionSchema } = require('../validators/schemas');
const { paginate } = require('../utils/pagination');
const { awardXP, checkAndAwardAchievements, updateStreak, updateChallengeProgress } = require('../services/gamificationEngine');

// ── Public routes ──

// GET /exercises
router.get('/exercises', async (req, res, next) => {
  try {
    const { muscle_group, equipment_type, search } = req.query;
    let query = 'SELECT * FROM exercises WHERE is_active = true';
    const params = [];

    if (muscle_group) {
      params.push(muscle_group);
      query += ` AND muscle_group = $${params.length}`;
    }
    if (equipment_type) {
      params.push(equipment_type);
      query += ` AND equipment_type = $${params.length}`;
    }
    if (search) {
      if (typeof search !== 'string' || search.length > 100) throw appError(ErrorCodes.VALIDATION_ERROR, 'Search query too long');
      params.push(`%${search}%`);
      query += ` AND name ILIKE $${params.length}`;
    }

    query += ' ORDER BY muscle_group, name';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /exercises/:id
router.get('/exercises/:id', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM exercises WHERE id = $1 AND is_active = true', [req.params.id]);
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Exercise not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /how-to — returns how-to guide for all exercises, keyed by name
router.get('/how-to', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT name, how_to_steps, how_to_tip FROM exercises WHERE how_to_steps IS NOT NULL AND is_active = true'
    );
    const map = {};
    for (const row of result.rows) {
      map[row.name] = { steps: row.how_to_steps, tip: row.how_to_tip };
    }
    res.json(map);
  } catch (err) {
    next(err);
  }
});

// GET /splits
router.get('/splits', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM workout_splits WHERE is_active = true');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ── Authenticated routes ──

// POST /generate
router.post('/generate', auth, validate(generateWorkoutSchema), async (req, res, next) => {
  try {
    const { split_type, equipment, days_per_week, intensity, fitness_goal, cycle_phase } = req.body;

    // Get split template
    const split = (await db.query('SELECT * FROM workout_splits WHERE id = $1', [split_type])).rows[0];
    if (!split) throw appError(ErrorCodes.NOT_FOUND, 'Split type not found');

    const dayConfigs = typeof split.day_configs === 'string' ? JSON.parse(split.day_configs) : split.day_configs;
    const daysPattern = typeof split.days_pattern === 'string' ? JSON.parse(split.days_pattern) : split.days_pattern;

    // Build plan: for each unique day type, pick exercises from matching muscle groups
    const plan = [];
    const usedDayTypes = new Set();

    for (let i = 0; i < daysPattern.length; i++) {
      const dayName = daysPattern[i];
      if (dayName === 'Rest') {
        plan.push({ day: i + 1, name: 'Rest', exercises: [] });
        continue;
      }

      const config = dayConfigs[dayName];
      if (!config) {
        plan.push({ day: i + 1, name: dayName, exercises: [] });
        continue;
      }

      const muscles = config.muscles || [];
      // Get exercises for these muscle groups
      const exercises = (await db.query(
        `SELECT * FROM exercises
         WHERE equipment_type = $1 AND muscle_group = ANY($2) AND is_active = true
         ORDER BY RANDOM()`,
        [equipment, muscles]
      )).rows;

      // Pick ~4-6 exercises per day depending on intensity
      const maxExercises = intensity === 'intense' ? 6 : intensity === 'light' ? 3 : 4;
      const selected = exercises.slice(0, maxExercises).map(ex => ({
        id: ex.id,
        name: ex.name,
        muscle_group: ex.muscle_group,
        sets: ex.default_sets,
        reps: ex.default_reps,
        target_muscles: ex.target_muscles,
      }));

      plan.push({ day: i + 1, name: dayName, focus: config.focus, exercises: selected });
      usedDayTypes.add(dayName);
    }

    res.json({
      split_type,
      split_name: split.name,
      equipment,
      days_per_week: daysPattern.filter(d => d !== 'Rest').length,
      intensity,
      cycle_phase,
      plan,
    });
  } catch (err) {
    next(err);
  }
});

// POST /plans
router.post('/plans', auth, validate(saveWorkoutPlanSchema), async (req, res, next) => {
  try {
    const { plan_name, split_type, days_per_week, equipment, intensity, cycle_phase, plan_data } = req.body;
    const result = await db.query(
      `INSERT INTO weekly_plans (user_id, plan_type, plan_name, split_type, days_per_week, equipment, intensity, cycle_phase, plan_data)
       VALUES ($1, 'workout', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, plan_name, split_type, days_per_week, equipment, intensity, cycle_phase, JSON.stringify(plan_data)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /plans
router.get('/plans', auth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await paginate(
      `SELECT * FROM weekly_plans WHERE user_id = $1 AND plan_type = 'workout' ORDER BY created_at DESC`,
      `SELECT COUNT(*) FROM weekly_plans WHERE user_id = $1 AND plan_type = 'workout'`,
      [req.user.id],
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /plans/:id
router.get('/plans/:id', auth, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM weekly_plans WHERE id = $1 AND user_id = $2 AND plan_type = $3',
      [req.params.id, req.user.id, 'workout']
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Workout plan not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /plans/:id
router.put('/plans/:id', auth, validate(updateWorkoutPlanSchema), async (req, res, next) => {
  try {
    const { plan_name, is_active, plan_data } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (plan_name !== undefined) { sets.push(`plan_name = $${idx++}`); vals.push(plan_name); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(is_active); }
    if (plan_data !== undefined) { sets.push(`plan_data = $${idx++}`); vals.push(JSON.stringify(plan_data)); }

    if (sets.length === 0) return res.json({ message: 'Nothing to update' });

    vals.push(req.params.id, req.user.id);
    const result = await db.query(
      `UPDATE weekly_plans SET ${sets.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} AND plan_type = 'workout' RETURNING *`,
      vals
    );

    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Workout plan not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /plans/:id
router.delete('/plans/:id', auth, async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM weekly_plans WHERE id = $1 AND user_id = $2 AND plan_type = $3 RETURNING id',
      [req.params.id, req.user.id, 'workout']
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Workout plan not found');
    res.json({ message: 'Workout plan deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /sessions
router.post('/sessions', auth, validate(logWorkoutSessionSchema), async (req, res, next) => {
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const { workout_date, workout_type, split_type, duration_minutes, exercises_completed, cycle_phase, notes } = req.body;

    const session = (await client.query(
      `INSERT INTO workout_sessions (user_id, workout_date, workout_type, split_type, duration_minutes, exercises_completed, xp_earned, cycle_phase, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, workout_date, workout_type, split_type, duration_minutes, exercises_completed, 25, cycle_phase, notes]
    )).rows[0];

    // Update gamification counters
    await client.query(
      'UPDATE user_gamification SET total_workouts = total_workouts + 1 WHERE user_id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    // Post-COMMIT gamification (non-critical — session is already saved)
    let newAchievements = [];
    try {
      await awardXP(req.user.id, 25);
      await updateStreak(req.user.id);
      await updateChallengeProgress(req.user.id, 'total_workouts', 1);
      newAchievements = await checkAndAwardAchievements(req.user.id);
    } catch (gamErr) {
      console.warn('[gamification] Post-session update failed:', gamErr.message);
    }

    res.status(201).json({ session, newAchievements });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

// GET /sessions
router.get('/sessions', auth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await paginate(
      `SELECT * FROM workout_sessions WHERE user_id = $1 ORDER BY workout_date DESC`,
      `SELECT COUNT(*) FROM workout_sessions WHERE user_id = $1`,
      [req.user.id],
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
