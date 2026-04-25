const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const { refreshWeeklyChallenges } = require('../services/gamificationEngine');

// GET /achievements (public)
router.get('/achievements', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM achievements WHERE is_active = true ORDER BY sort_order');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /user-achievements (authed)
router.get('/user-achievements', auth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT ua.*, a.title, a.icon, a.description, a.category
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.unlocked_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /challenges (public)
router.get('/challenges', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM challenges WHERE is_active = true');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /user-challenges (authed)
router.get('/user-challenges', auth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT wc.*, c.name, c.icon, c.metric_key, c.xp_reward AS reward
       FROM weekly_challenges wc
       JOIN challenges c ON c.id = wc.challenge_id
       WHERE wc.user_id = $1
       ORDER BY wc.week_start DESC, wc.created_at`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /refresh-challenges (authed)
router.post('/refresh-challenges', auth, async (req, res, next) => {
  try {
    const challenges = await refreshWeeklyChallenges(req.user.id);
    res.json(challenges);
  } catch (err) {
    next(err);
  }
});

// GET /levels (public)
router.get('/levels', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM levels ORDER BY level');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
