const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/sync/all
// Returns everything syncTrackingDataFromServer() needs in a single round-trip.
// Replaces 14+ individual API calls on login with 1 call.
router.get('/all', async (req, res, next) => {
  const uid = req.user.id;
  try {
    const [
      profileRow,
      prefsRow,
      gamRow,
      scansRows,
      sleepRows,
      hydrationRows,
      goalWeightRow,
      weightLogRows,
      measurementRows,
      workoutSessionRows,
      liftRows,
      wearableRows,
      achievementRows,
      latestPlanRows,
      todayFoodRow,
    ] = await Promise.all([
      // Profile
      db.query(
        `SELECT gender, height, weight, age_range, activity_level, fitness_goal, experience_level
         FROM users WHERE id = $1`, [uid]
      ),
      // Preferences
      db.query(
        `SELECT coach_persona, step_goal, weight_unit, height_unit
         FROM user_preferences WHERE user_id = $1`, [uid]
      ),
      // Gamification
      db.query(
        `SELECT total_xp, current_streak, total_workouts, total_analyses
         FROM user_gamification WHERE user_id = $1`, [uid]
      ),
      // Latest 50 scans
      db.query(
        `SELECT s.*, row_to_json(r.*) AS results
         FROM analysis_scans s
         LEFT JOIN analysis_results r ON r.scan_id = s.id
         WHERE s.user_id = $1
         ORDER BY s.scan_date DESC LIMIT 50`, [uid]
      ),
      // Sleep log (365 days)
      db.query(
        `SELECT sleep_date::text AS date, hours, quality
         FROM sleep_logs WHERE user_id = $1
         AND sleep_date >= NOW() - INTERVAL '365 days'
         ORDER BY sleep_date DESC`, [uid]
      ),
      // Hydration (30 days)
      db.query(
        `SELECT log_date::text AS date, glasses_drunk
         FROM hydration_logs WHERE user_id = $1
         AND log_date >= NOW() - INTERVAL '30 days'
         ORDER BY log_date DESC`, [uid]
      ),
      // Goal weight
      db.query(
        `SELECT goal_kg, start_kg, set_at
         FROM goal_weight WHERE user_id = $1`, [uid]
      ),
      // Weight log (365 days)
      db.query(
        `SELECT log_date::text AS date, weight_kg AS weight
         FROM weight_log WHERE user_id = $1
         AND log_date >= NOW() - INTERVAL '365 days'
         ORDER BY log_date DESC`, [uid]
      ),
      // Measurements (365 days)
      db.query(
        `SELECT log_date::text AS date, chest, waist, hips, arms
         FROM measurement_logs WHERE user_id = $1
         AND log_date >= NOW() - INTERVAL '365 days'
         ORDER BY log_date DESC`, [uid]
      ),
      // Workout sessions (last 40)
      db.query(
        `SELECT id, workout_date, workout_type, notes, duration_minutes, xp_earned
         FROM workout_sessions WHERE user_id = $1
         ORDER BY workout_date DESC LIMIT 40`, [uid]
      ),
      // Lift log
      db.query(
        `SELECT exercise_name, log_date::text AS date, weight_kg AS weight, reps, e1rm
         FROM lift_log WHERE user_id = $1
         ORDER BY exercise_name, log_date DESC`, [uid]
      ),
      // Wearable sessions (90 days)
      db.query(
        `SELECT session_date::text AS date, steps, hr_avg, calories, active_secs
         FROM wearable_sessions WHERE user_id = $1
         AND session_date >= NOW() - INTERVAL '90 days'
         ORDER BY session_date DESC LIMIT 90`, [uid]
      ),
      // Achievements
      db.query(
        `SELECT ua.achievement_id, a.title, a.icon
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id = $1
         ORDER BY ua.unlocked_at DESC`, [uid]
      ),
      // Latest workout plan
      db.query(
        `SELECT plan_data FROM weekly_plans WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`, [uid]
      ),
      // Today's food totals
      db.query(
        `SELECT COALESCE(SUM(calories),0)::numeric AS total_calories,
                COALESCE(SUM(protein),0)::numeric  AS total_protein,
                COALESCE(SUM(carbs),0)::numeric    AS total_carbs,
                COALESCE(SUM(fats),0)::numeric     AS total_fats
         FROM food_log WHERE user_id = $1 AND log_date = CURRENT_DATE`, [uid]
      ),
    ]);

    res.json({
      profile:      profileRow.rows[0] || null,
      preferences:  prefsRow.rows[0]   || null,
      gamification: gamRow.rows[0]     || null,
      scans:        scansRows.rows,
      sleep:        sleepRows.rows,
      hydration:    hydrationRows.rows,
      goalWeight:   goalWeightRow.rows[0] || null,
      weightLog:    weightLogRows.rows,
      measurements: measurementRows.rows,
      workoutSessions: workoutSessionRows.rows,
      lifts:        liftRows.rows,
      wearable:     wearableRows.rows,
      achievements: achievementRows.rows,
      latestPlan:   latestPlanRows.rows[0] || null,
      todayFood:    todayFoodRow.rows[0]   || null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
