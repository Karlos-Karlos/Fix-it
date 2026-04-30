const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { appError, ErrorCodes } = require('../utils/errors');
const { recognizeFoodSchema, generateMealPlanSchema, saveMealPlanSchema, logFoodSchema } = require('../validators/schemas');
const { paginate } = require('../utils/pagination');
const { awardXP, checkAndAwardAchievements, updateChallengeProgress } = require('../services/gamificationEngine');
const { uploadLimiter } = require('../middleware/rateLimiter');

// ── Public routes ──

// GET /meals — returns all active meal templates grouped by diet then meal_type
router.get('/meals', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM meals WHERE is_active = true ORDER BY diet, meal_type, id');
    const grouped = {};
    for (const row of result.rows) {
      const diet = row.diet || 'standard';
      if (!grouped[diet]) grouped[diet] = {};
      if (!grouped[diet][row.meal_type]) grouped[diet][row.meal_type] = [];
      let foods;
      try {
        foods = typeof row.foods === 'string' ? JSON.parse(row.foods) : row.foods;
      } catch {
        foods = [];
      }
      grouped[diet][row.meal_type].push({ name: row.name, icon: row.icon, foods });
    }
    res.json(grouped);
  } catch (err) {
    next(err);
  }
});

// GET /foods
router.get('/foods', async (req, res, next) => {
  try {
    const { search, category } = req.query;
    let query = 'SELECT * FROM foods WHERE is_active = true';
    const params = [];

    if (search) {
      if (typeof search !== 'string' || search.length > 100) throw appError(ErrorCodes.VALIDATION_ERROR, 'Search query too long');
      params.push(`%${search}%`);
      query += ` AND name ILIKE $${params.length}`;
    }
    if (category) {
      if (typeof category !== 'string') throw appError(ErrorCodes.VALIDATION_ERROR, 'Invalid category');
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ' ORDER BY name';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /foods/categories — must be before /foods/:id
router.get('/foods/categories', async (req, res, next) => {
  try {
    const result = await db.query('SELECT DISTINCT category FROM foods WHERE category IS NOT NULL ORDER BY category');
    res.json(result.rows.map(r => r.category));
  } catch (err) {
    next(err);
  }
});

// GET /foods/:id
router.get('/foods/:id', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM foods WHERE id = $1 AND is_active = true', [req.params.id]);
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Food not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── Authenticated routes ──

// POST /foods/recognize
router.post('/foods/recognize', auth, validate(recognizeFoodSchema), async (req, res, next) => {
  try {
    const { ml_label } = req.body;
    const mapping = (await db.query(
      `SELECT frm.*, f.* FROM food_recognition_mappings frm
       JOIN foods f ON f.id = frm.food_id
       WHERE frm.ml_label = $1`,
      [ml_label]
    )).rows[0];

    if (!mapping) throw appError(ErrorCodes.NOT_FOUND, 'No food mapping found for that label');

    // Track food scanning
    await db.query(
      'UPDATE user_gamification SET food_scanned = true WHERE user_id = $1',
      [req.user.id]
    );
    await checkAndAwardAchievements(req.user.id);

    res.json(mapping);
  } catch (err) {
    next(err);
  }
});

// POST /meal-plans/generate
router.post('/meal-plans/generate', auth, uploadLimiter, validate(generateMealPlanSchema), async (req, res, next) => {
  try {
    const { calorie_target, protein_target, meals_per_day, fitness_goal, preferences } = req.body;

    // Get user profile for defaults
    const user = (await db.query(
      'SELECT weight, fitness_goal FROM users WHERE id = $1', [req.user.id]
    )).rows[0];

    const goal = fitness_goal || user?.fitness_goal || 'maintain';
    const weight = user?.weight || 70;
    const targetCals = calorie_target || (goal === 'lose_weight' ? Math.round(weight * 24) : goal === 'build_muscle' ? Math.round(weight * 32) : Math.round(weight * 28));
    const targetProtein = protein_target || Math.round(weight * 1.8);

    // Get foods by category
    const allFoods = (await db.query('SELECT * FROM foods WHERE is_active = true ORDER BY category, name')).rows;

    const proteins = allFoods.filter(f => f.category === 'protein');
    const carbs = allFoods.filter(f => f.category === 'carbs');
    const vegs = allFoods.filter(f => ['vegetables', 'fruit'].includes(f.category));
    const fats = allFoods.filter(f => f.category === 'fats');

    // Build simple meal plan
    const calsPerMeal = Math.round(targetCals / meals_per_day);
    const meals = [];

    const mealNames = ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2', 'Snack 3'];

    for (let i = 0; i < meals_per_day; i++) {
      const mealFoods = [];

      // Pick a protein source
      const protein = proteins[Math.floor(Math.random() * proteins.length)];
      if (protein) mealFoods.push({ ...protein, quantity: 1 });

      // Pick a carb source
      const carb = carbs[Math.floor(Math.random() * carbs.length)];
      if (carb) mealFoods.push({ ...carb, quantity: 1 });

      // Pick a vegetable/fruit
      const veg = vegs[Math.floor(Math.random() * vegs.length)];
      if (veg) mealFoods.push({ ...veg, quantity: 1 });

      // Optionally add fat source
      if (i < 2) {
        const fat = fats[Math.floor(Math.random() * fats.length)];
        if (fat) mealFoods.push({ ...fat, quantity: 0.5 });
      }

      const totalCals = mealFoods.reduce((sum, f) => sum + (f.calories * f.quantity), 0);
      const totalProtein = mealFoods.reduce((sum, f) => sum + ((parseFloat(f.protein) || 0) * f.quantity), 0);

      meals.push({
        name: mealNames[i] || `Meal ${i + 1}`,
        target_calories: calsPerMeal,
        foods: mealFoods.map(f => ({ id: f.id, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fats: f.fats, portion: f.portion, icon: f.icon, quantity: f.quantity })),
        total_calories: Math.round(totalCals),
        total_protein: Math.round(totalProtein),
      });
    }

    res.json({
      calorie_target: targetCals,
      protein_target: targetProtein,
      meals_per_day,
      goal,
      meals,
    });
  } catch (err) {
    next(err);
  }
});

// POST /meal-plans
router.post('/meal-plans', auth, validate(saveMealPlanSchema), async (req, res, next) => {
  try {
    const { plan_name, plan_data } = req.body;
    const result = await db.query(
      `INSERT INTO weekly_plans (user_id, plan_type, plan_name, plan_data)
       VALUES ($1, 'meal', $2, $3) RETURNING *`,
      [req.user.id, plan_name, JSON.stringify(plan_data)]
    );

    // Gamification (non-critical — plan is already saved)
    let newAchievements = [];
    try {
      await db.query(
        'UPDATE user_gamification SET meal_plans_generated = meal_plans_generated + 1 WHERE user_id = $1',
        [req.user.id]
      );
      await awardXP(req.user.id, 10);
      await updateChallengeProgress(req.user.id, 'meal_plans_generated', 1);
      newAchievements = await checkAndAwardAchievements(req.user.id);
    } catch (gamErr) {
      console.warn('[gamification] Post-meal-plan update failed:', gamErr.message);
    }

    res.status(201).json({ plan: result.rows[0], newAchievements });
  } catch (err) {
    next(err);
  }
});

// GET /meal-plans
router.get('/meal-plans', auth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await paginate(
      `SELECT * FROM weekly_plans WHERE user_id = $1 AND plan_type = 'meal' ORDER BY created_at DESC`,
      `SELECT COUNT(*) FROM weekly_plans WHERE user_id = $1 AND plan_type = 'meal'`,
      [req.user.id],
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /food-log
router.post('/food-log', auth, validate(logFoodSchema), async (req, res, next) => {
  try {
    const { food_id, log_date, meal_type, food_name, calories, protein, carbs, fats, portion, quantity, is_scanned } = req.body;
    const result = await db.query(
      `INSERT INTO food_log (user_id, food_id, log_date, meal_type, food_name, calories, protein, carbs, fats, portion, quantity, is_scanned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, food_id, log_date, meal_type, food_name, calories, protein, carbs, fats, portion, quantity, is_scanned]
    );

    // Track nutrition view
    await db.query(
      'UPDATE user_gamification SET nutrition_views = nutrition_views + 1 WHERE user_id = $1',
      [req.user.id]
    );
    await updateChallengeProgress(req.user.id, 'nutrition_views', 1);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /food-log/daily
router.get('/food-log/daily', auth, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw appError(ErrorCodes.VALIDATION_ERROR, 'date query parameter required');

    const entries = (await db.query(
      'SELECT * FROM food_log WHERE user_id = $1 AND log_date = $2 ORDER BY created_at',
      [req.user.id, date]
    )).rows;

    const totals = (await db.query(
      `SELECT COALESCE(SUM(calories * quantity), 0)::int AS total_calories,
              COALESCE(SUM(protein * quantity), 0)::numeric(8,2) AS total_protein,
              COALESCE(SUM(carbs * quantity), 0)::numeric(8,2) AS total_carbs,
              COALESCE(SUM(fats * quantity), 0)::numeric(8,2) AS total_fats
       FROM food_log WHERE user_id = $1 AND log_date = $2`,
      [req.user.id, date]
    )).rows[0];

    res.json({ entries, totals });
  } catch (err) {
    next(err);
  }
});

// DELETE /food-log/:id
router.delete('/food-log/:id', auth, async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM food_log WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'Food log entry not found');
    res.json({ message: 'Food log entry deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
