const db = require('../database/db');

/**
 * Get the Monday of the current week as a YYYY-MM-DD string.
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().slice(0, 10);
}

/**
 * Add XP to a user's gamification record.
 */
async function awardXP(userId, amount) {
  await db.query(
    `UPDATE user_gamification SET total_xp = total_xp + $1 WHERE user_id = $2`,
    [amount, userId]
  );
}

/**
 * Check all 14 achievement conditions and award any new ones.
 */
async function checkAndAwardAchievements(userId) {
  const gam = (await db.query(`SELECT * FROM user_gamification WHERE user_id = $1`, [userId])).rows[0];
  if (!gam) return [];

  const existing = (await db.query(
    `SELECT achievement_id FROM user_achievements WHERE user_id = $1`, [userId]
  )).rows.map(r => r.achievement_id);

  const personaCount = (await db.query(
    `SELECT COUNT(*)::int AS cnt FROM user_personas_used WHERE user_id = $1`, [userId]
  )).rows[0].cnt;

  // Fetch per-achievement XP rewards from DB so we honour individual xp_reward values
  const achRows = (await db.query(`SELECT id, xp_reward FROM achievements`)).rows;
  const xpMap = {};
  for (const a of achRows) xpMap[a.id] = a.xp_reward ?? 25;

  const conditions = [
    { id: 'first-scan',    check: gam.total_analyses >= 1 },
    { id: 'scan-veteran',  check: gam.total_analyses >= 5 },
    { id: 'first-workout', check: gam.total_workouts >= 1 },
    { id: 'workout-5',     check: gam.total_workouts >= 5 },
    { id: 'workout-10',    check: gam.total_workouts >= 10 },
    { id: 'workout-25',    check: gam.total_workouts >= 25 },
    { id: 'meal-plan',     check: gam.meal_plans_generated >= 1 },
    { id: 'food-scan',     check: gam.food_scanned === true },
    { id: 'all-personas',  check: personaCount >= 4 },
    { id: 'streak-3',      check: gam.best_streak >= 3 },
    { id: 'streak-7',      check: gam.best_streak >= 7 },
    { id: 'streak-30',     check: gam.best_streak >= 30 },
    { id: 'first-compare', check: gam.first_compare_done === true },
    { id: 'scan-5',        check: gam.total_analyses >= 5 },
  ];

  const newlyUnlocked = [];
  for (const c of conditions) {
    if (c.check && !existing.includes(c.id)) {
      await db.query(
        `INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, c.id]
      );
      await awardXP(userId, xpMap[c.id] ?? 25);
      newlyUnlocked.push(c.id);
    }
  }

  return newlyUnlocked;
}

/**
 * Update the user's workout streak.
 */
async function updateStreak(userId) {
  const gam = (await db.query(`SELECT * FROM user_gamification WHERE user_id = $1`, [userId])).rows[0];
  if (!gam) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastDate = gam.last_workout_date ? new Date(gam.last_workout_date) : null;
  if (lastDate) lastDate.setHours(0, 0, 0, 0);

  let newStreak = gam.current_streak;

  if (lastDate) {
    const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      // Already logged today, no change
      return;
    } else if (diffDays === 1) {
      newStreak += 1;
    } else {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  const bestStreak = Math.max(newStreak, gam.best_streak);

  await db.query(
    `UPDATE user_gamification
     SET current_streak = $1, best_streak = $2, last_workout_date = $3
     WHERE user_id = $4`,
    [newStreak, bestStreak, today, userId]
  );
}

/**
 * Assign 3 random weekly challenges if it's a new week.
 */
async function refreshWeeklyChallenges(userId) {
  const weekStr = getWeekStart();

  // Check if already has challenges this week
  const existing = await db.query(
    `SELECT id FROM weekly_challenges WHERE user_id = $1 AND week_start = $2`,
    [userId, weekStr]
  );
  if (existing.rows.length > 0) return existing.rows;

  // Pick 3 random challenges
  const pool = await db.query(`SELECT * FROM challenges WHERE is_active = true ORDER BY RANDOM() LIMIT 3`);

  const inserted = [];
  for (const ch of pool.rows) {
    const r = await db.query(
      `INSERT INTO weekly_challenges (user_id, challenge_id, week_start, target)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, ch.id, weekStr, ch.target]
    );
    inserted.push(r.rows[0]);
  }

  return inserted;
}

/**
 * Update progress on matching weekly challenges.
 */
async function updateChallengeProgress(userId, metricKey, value) {
  const weekStr = getWeekStart();

  // Find matching challenges for this metric, include xp_reward from the challenge definition
  const challenges = await db.query(
    `SELECT wc.*, c.xp_reward FROM weekly_challenges wc
     JOIN challenges c ON c.id = wc.challenge_id
     WHERE wc.user_id = $1 AND wc.week_start = $2 AND c.metric_key = $3 AND wc.is_completed = false`,
    [userId, weekStr, metricKey]
  );

  for (const ch of challenges.rows) {
    const newProgress = Math.min(ch.current_progress + value, ch.target);
    const isCompleted = newProgress >= ch.target;
    const xpReward = ch.xp_reward ?? 25;

    await db.query(
      `UPDATE weekly_challenges
       SET current_progress = $1, is_completed = $2, completed_at = $3, xp_awarded = $4
       WHERE id = $5`,
      [newProgress, isCompleted, isCompleted ? new Date() : null, isCompleted ? xpReward : 0, ch.id]
    );

    if (isCompleted) {
      await awardXP(userId, xpReward);
    }
  }
}

module.exports = {
  awardXP,
  checkAndAwardAchievements,
  updateStreak,
  refreshWeeklyChallenges,
  updateChallengeProgress,
};
