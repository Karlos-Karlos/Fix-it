const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const validate = require('../middleware/validate');
const { appError, ErrorCodes } = require('../utils/errors');
const {
  adminUpdateUserSchema,
  adminResetPasswordSchema,
  uuidParamSchema,
  stringIdParamSchema,
  createFoodSchema,
  createExerciseSchema,
  createAchievementSchema,
  createChallengeSchema,
  createSplitSchema,
} = require('../validators/schemas');
const { paginate } = require('../utils/pagination');
const { adminLimiter } = require('../middleware/rateLimiter');

// All routes require auth + admin + rate limit
router.use(auth, admin, adminLimiter);

// GET /users
router.get('/users', async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    let where = '';
    const params = [];

    if (search) {
      if (typeof search !== 'string' || search.length > 100) throw appError(ErrorCodes.VALIDATION_ERROR, 'Search query too long');
      params.push(`%${search}%`);
      where = `WHERE email ILIKE $1 OR display_name ILIKE $1`;
    }

    const result = await paginate(
      `SELECT id, email, display_name, role, email_verified, locked_until, created_at, last_login_at FROM users ${where} ORDER BY created_at DESC`,
      `SELECT COUNT(*) FROM users ${where}`,
      params,
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /users/:id
router.get('/users/:id', validate(uuidParamSchema, 'params'), async (req, res, next) => {
  try {
    const user = (await db.query(
      `SELECT id, email, display_name, gender, role, email_verified, locked_until, created_at, last_login_at
       FROM users WHERE id = $1`,
      [req.params.id]
    )).rows[0];
    if (!user) throw appError(ErrorCodes.NOT_FOUND, 'User not found');

    const gam = (await db.query(
      'SELECT * FROM user_gamification WHERE user_id = $1',
      [req.params.id]
    )).rows[0];

    res.json({ ...user, gamification: gam || null });
  } catch (err) {
    next(err);
  }
});

// PUT /users/:id
router.put('/users/:id', validate(uuidParamSchema, 'params'), validate(adminUpdateUserSchema), async (req, res, next) => {
  try {
    // Can't demote self
    if (req.params.id === req.user.id && req.body.role && req.body.role !== 'admin') {
      throw appError(ErrorCodes.FORBIDDEN, 'Cannot change your own admin role');
    }

    const { role, email_verified, display_name, email } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (role !== undefined) { sets.push(`role = $${idx++}`); vals.push(role); }
    if (email_verified !== undefined) {
      sets.push(`email_verified = $${idx++}`);
      vals.push(email_verified);
      if (email_verified) {
        sets.push(`email_verified_at = NOW()`);
      } else {
        sets.push(`email_verified_at = NULL`);
      }
    }
    if (display_name !== undefined) { sets.push(`display_name = $${idx++}`); vals.push(display_name); }
    if (email !== undefined) {
      // Check for duplicate email
      const existing = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.params.id]);
      if (existing.rows.length > 0) throw appError(ErrorCodes.EMAIL_EXISTS, 'Email already in use by another account');
      sets.push(`email = $${idx++}`);
      vals.push(email);
    }

    if (sets.length === 0) return res.json({ message: 'Nothing to update' });

    vals.push(req.params.id);
    const result = await db.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx}
       RETURNING id, email, display_name, role, email_verified, updated_at`,
      vals
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

const SALT_ROUNDS = 12;

// POST /users/:id/reset-password (admin sets new password)
router.post('/users/:id/reset-password', validate(uuidParamSchema, 'params'), validate(adminResetPasswordSchema), async (req, res, next) => {
  try {
    const { password } = req.body;
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
      [hash, req.params.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    // Revoke all user sessions so they must re-login
    await db.query('UPDATE user_sessions SET is_revoked = true WHERE user_id = $1', [req.params.id]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /users/:id
router.delete('/users/:id', validate(uuidParamSchema, 'params'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      throw appError(ErrorCodes.FORBIDDEN, 'Cannot delete your own admin account');
    }

    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /users/:id/unlock
router.post('/users/:id/unlock', validate(uuidParamSchema, 'params'), async (req, res, next) => {
  try {
    const result = await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id, email',
      [req.params.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    res.json({ message: 'Account unlocked', user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /users/:id/lock
router.post('/users/:id/lock', validate(uuidParamSchema, 'params'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      throw appError(ErrorCodes.FORBIDDEN, 'Cannot lock your own admin account');
    }

    // Lock for 100 years (effectively permanent until unlocked)
    const result = await db.query(
      `UPDATE users SET locked_until = NOW() + INTERVAL '100 years', failed_login_attempts = $1 WHERE id = $2 RETURNING id, email`,
      [5, req.params.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');
    res.json({ message: 'Account locked', user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /stats
router.get('/stats', async (req, res, next) => {
  try {
    const [users, scans, workouts, newThisWeek] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM users'),
      db.query('SELECT COUNT(*)::int AS count FROM analysis_scans'),
      db.query('SELECT COUNT(*)::int AS count FROM workout_sessions'),
      db.query("SELECT COUNT(*)::int AS count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'"),
    ]);

    res.json({
      total_users: users.rows[0].count,
      total_scans: scans.rows[0].count,
      total_workouts: workouts.rows[0].count,
      new_signups_this_week: newThisWeek.rows[0].count,
    });
  } catch (err) {
    next(err);
  }
});

// ========== GENERIC CONTENT TABLE CRUD ==========

const contentTables = {
  foods: {
    table: 'foods',
    columns: ['name','calories','protein','carbs','fats','fiber','sugar','sodium','portion','portion_grams','icon','category','tags','is_active'],
    searchCols: ['name', 'category'],
    orderBy: 'name ASC',
    idType: 'uuid',
    createSchema: createFoodSchema,
    paramSchema: uuidParamSchema,
  },
  exercises: {
    table: 'exercises',
    columns: ['name','muscle_group','equipment_type','default_sets','default_reps','target_muscles','difficulty','instructions','video_url','is_active'],
    searchCols: ['name', 'muscle_group'],
    orderBy: 'name ASC',
    idType: 'uuid',
    createSchema: createExerciseSchema,
    paramSchema: uuidParamSchema,
  },
  achievements: {
    table: 'achievements',
    columns: ['id','title','icon','description','category','xp_reward','sort_order','is_active'],
    searchCols: ['title', 'description'],
    orderBy: 'sort_order ASC, title ASC',
    idType: 'varchar',
    manualId: true,
    createSchema: createAchievementSchema,
    paramSchema: stringIdParamSchema,
  },
  challenges: {
    table: 'challenges',
    columns: ['id','name','icon','target','metric_key','xp_reward','category','is_active'],
    searchCols: ['name', 'category'],
    orderBy: 'name ASC',
    idType: 'varchar',
    manualId: true,
    createSchema: createChallengeSchema,
    paramSchema: stringIdParamSchema,
  },
  splits: {
    table: 'workout_splits',
    columns: ['id','name','description','days_pattern','day_configs','recommended_for','is_active'],
    searchCols: ['name', 'description'],
    orderBy: 'name ASC',
    idType: 'varchar',
    manualId: true,
    createSchema: createSplitSchema,
    paramSchema: stringIdParamSchema,
  }
};

Object.entries(contentTables).forEach(([route, cfg]) => {
  // GET list with pagination + search
  router.get(`/${route}`, async (req, res, next) => {
    try {
      const { page, limit, search } = req.query;
      let where = '';
      const params = [];

      if (search && cfg.searchCols.length > 0) {
        if (typeof search !== 'string' || search.length > 100) throw appError(ErrorCodes.VALIDATION_ERROR, 'Search query too long');
        params.push(`%${search}%`);
        const clauses = cfg.searchCols.map(c => `${c} ILIKE $1`);
        where = `WHERE ${clauses.join(' OR ')}`;
      }

      const result = await paginate(
        `SELECT * FROM ${cfg.table} ${where} ORDER BY ${cfg.orderBy}`,
        `SELECT COUNT(*) FROM ${cfg.table} ${where}`,
        params,
        { page, limit }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST create
  router.post(`/${route}`, validate(cfg.createSchema), async (req, res, next) => {
    try {
      const cols = cfg.manualId ? cfg.columns : cfg.columns.filter(c => c !== 'id');
      const vals = cols.map(c => {
        const v = req.body[c];
        if (v !== undefined && typeof v === 'object' && v !== null) return JSON.stringify(v);
        return v !== undefined ? v : null;
      });
      const placeholders = cols.map((_, i) => `$${i + 1}`);

      const result = await db.query(
        `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        vals
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // PUT update
  router.put(`/${route}/:id`, validate(cfg.paramSchema, 'params'), validate(cfg.createSchema.partial()), async (req, res, next) => {
    try {
      const updateCols = (cfg.manualId ? cfg.columns.filter(c => c !== 'id') : cfg.columns);
      const sets = [];
      const vals = [];
      let idx = 1;

      updateCols.forEach(c => {
        if (req.body[c] !== undefined) {
          let v = req.body[c];
          if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
          sets.push(`${c} = $${idx++}`);
          vals.push(v);
        }
      });

      if (sets.length === 0) return res.json({ message: 'Nothing to update' });

      vals.push(req.params.id);
      const result = await db.query(
        `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        vals
      );
      if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, `${route} item not found`);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // DELETE
  router.delete(`/${route}/:id`, validate(cfg.paramSchema, 'params'), async (req, res, next) => {
    try {
      const result = await db.query(
        `DELETE FROM ${cfg.table} WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, `${route} item not found`);
      res.json({ message: 'Deleted' });
    } catch (err) {
      next(err);
    }
  });
});

module.exports = router;
