const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { appError, ErrorCodes } = require('../utils/errors');
const { updateProfileSchema, updatePreferencesSchema } = require('../validators/schemas');



// All routes require auth
router.use(auth);

// GET /me
router.get('/me', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, email, email_verified, display_name, gender, height, weight,
              age_range, activity_level, fitness_goal, experience_level, avatar_url, role,
              last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /me
router.put('/me', validate(updateProfileSchema), async (req, res, next) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
    if (keys.length === 0) return res.json({ message: 'Nothing to update' });

    // If email is being changed, check for duplicates
    if (fields.email) {
      const existing = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [fields.email, req.user.id]
      );
      if (existing.rows.length > 0) {
        throw appError(ErrorCodes.EMAIL_EXISTS, 'Email already in use by another account');
      }
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    setClauses.push('updated_at = NOW()');
    const values = keys.map(k => fields[k]);

    const result = await db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${keys.length + 1}
       RETURNING id, email, display_name, gender, height, weight, age_range, activity_level, fitness_goal, experience_level, avatar_url, role, updated_at`,
      [...values, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /me/preferences
router.get('/me/preferences', async (req, res, next) => {
  try {
    let result = await db.query('SELECT * FROM user_preferences WHERE user_id = $1', [req.user.id]);

    if (result.rows.length === 0) {
      result = await db.query(
        'INSERT INTO user_preferences (user_id) VALUES ($1) RETURNING *',
        [req.user.id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /me/preferences
router.put('/me/preferences', validate(updatePreferencesSchema), async (req, res, next) => {
  try {
    const { theme, coach_persona } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (theme !== undefined) { sets.push(`theme = $${idx++}`); vals.push(theme); }
    if (coach_persona !== undefined) { sets.push(`coach_persona = $${idx++}`); vals.push(coach_persona); }

    if (sets.length === 0) return res.json({ message: 'Nothing to update' });

    vals.push(req.user.id);
    const result = await db.query(
      `UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = $${idx} RETURNING *`,
      vals
    );

    // Track persona usage
    if (coach_persona) {
      await db.query(
        `INSERT INTO user_personas_used (user_id, persona) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, coach_persona]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /me/gamification
router.get('/me/gamification', async (req, res, next) => {
  try {
    const gam = (await db.query('SELECT * FROM user_gamification WHERE user_id = $1', [req.user.id])).rows[0];
    if (!gam) throw appError(ErrorCodes.NOT_FOUND, 'Gamification record not found');

    // Current level
    const level = (await db.query(
      'SELECT * FROM levels WHERE xp_required <= $1 ORDER BY level DESC LIMIT 1',
      [gam.total_xp]
    )).rows[0] || { level: 1, rank_name: 'Beginner', xp_required: 0 };

    // Next level
    const nextLevel = (await db.query(
      'SELECT * FROM levels WHERE xp_required > $1 ORDER BY level ASC LIMIT 1',
      [gam.total_xp]
    )).rows[0];

    res.json({
      ...gam,
      current_level: level.level,
      rank_name: level.rank_name,
      next_level_xp: nextLevel ? nextLevel.xp_required : null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /me/data — wipe all user data but keep the account profile
router.delete('/me/data', async (req, res, next) => {
  const uid = req.user.id;
  try {
    // Delete uploaded scan images from disk first
    const scans = (await db.query(
      'SELECT image_url, thumbnail_url FROM analysis_scans WHERE user_id = $1', [uid]
    )).rows;
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    scans.forEach(scan => {
      [scan.image_url, scan.thumbnail_url].forEach(url => {
        if (url) fs.unlink(path.join(uploadsDir, path.basename(url)), () => {});
      });
    });

    // Delete all user-owned data (keep users + user_preferences rows)
    const tables = [
      'analysis_scans',
      'analysis_results',
      'coach_conversations',
      'food_log',
      'goal_weight',
      'hydration_logs',
      'lift_log',
      'measurement_logs',
      'meals',
      'sleep_logs',
      'user_achievements',
      'user_personas_used',
      'user_sessions',
      'wearable_sessions',
      'weekly_challenges',
      'weekly_plans',
      'weight_log',
      'workout_sessions',
    ];
    for (const table of tables) {
      await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [uid]).catch(() => {});
    }

    // Reset gamification to fresh state instead of deleting
    await db.query(
      `UPDATE user_gamification
       SET xp=0, level=1, scans_completed=0, workouts_logged=0,
           meals_logged=0, streak_days=0, meal_plans_generated=0,
           updated_at=NOW()
       WHERE user_id = $1`,
      [uid]
    ).catch(() => {});

    res.json({ message: 'All data cleared. Your account is ready for a fresh start.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /me
router.delete('/me', async (req, res, next) => {
  try {
    // Gather uploaded files before cascade-deleting
    const scans = (await db.query(
      'SELECT image_url, thumbnail_url FROM analysis_scans WHERE user_id = $1',
      [req.user.id]
    )).rows;

    await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);

    // Clean up uploaded images from disk
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    scans.forEach(scan => {
      [scan.image_url, scan.thumbnail_url].forEach(url => {
        if (url) {
          const filePath = path.join(uploadsDir, path.basename(url));
          fs.unlink(filePath, () => {}); // best-effort, ignore errors
        }
      });
    });

    res.json({ message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
