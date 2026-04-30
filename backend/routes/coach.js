const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { coachMessageSchema } = require('../validators/schemas');
const { paginate } = require('../utils/pagination');
const { processMessage } = require('../services/coachEngine');
const { awardXP, checkAndAwardAchievements, updateChallengeProgress } = require('../services/gamificationEngine');
const crypto = require('crypto');
const { coachLimiter } = require('../middleware/rateLimiter');

// All routes require auth
router.use(auth);

// POST /message
router.post('/message', coachLimiter, validate(coachMessageSchema), async (req, res, next) => {
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const { message, persona } = req.body;
    const rawSessionId = req.headers['x-session-id'];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const sessionId = (rawSessionId && uuidRegex.test(rawSessionId)) ? rawSessionId : crypto.randomUUID();

    // Process through coach engine
    const { intent, response } = await processMessage(req.user.id, message, persona);

    // Save user message
    await client.query(
      `INSERT INTO coach_conversations (user_id, session_id, role, message, intent, persona)
       VALUES ($1, $2, 'user', $3, $4, $5)`,
      [req.user.id, sessionId, message, intent, persona]
    );

    // Save coach response
    await client.query(
      `INSERT INTO coach_conversations (user_id, session_id, role, message, intent, persona)
       VALUES ($1, $2, 'coach', $3, $4, $5)`,
      [req.user.id, sessionId, response, intent, persona]
    );

    // Track persona usage — capture whether this is a new persona (RETURNING returns nothing on conflict)
    const personaInsertResult = await client.query(
      `INSERT INTO user_personas_used (user_id, persona) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
      [req.user.id, persona]
    );
    const isNewPersona = personaInsertResult.rows.length > 0;

    // Gamification
    await client.query(
      'UPDATE user_gamification SET coach_questions = coach_questions + 1 WHERE user_id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    // Post-COMMIT gamification (non-critical — conversation is already saved)
    let newAchievements = [];
    try {
      await awardXP(req.user.id, 5);
      await updateChallengeProgress(req.user.id, 'coach_questions', 1);
      if (isNewPersona) {
        await updateChallengeProgress(req.user.id, 'personas_used', 1);
      }
      newAchievements = await checkAndAwardAchievements(req.user.id);
    } catch (gamErr) {
      console.warn('[gamification] Post-coach update failed:', gamErr.message);
    }

    res.json({ intent, response, sessionId, newAchievements });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

// GET /conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await paginate(
      `SELECT * FROM coach_conversations WHERE user_id = $1 ORDER BY created_at DESC`,
      `SELECT COUNT(*) FROM coach_conversations WHERE user_id = $1`,
      [req.user.id],
      { page, limit }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /personas
router.get('/personas', async (req, res, next) => {
  try {
    res.json([
      { id: 'encouraging', name: 'Encouraging Coach', description: 'Supportive and motivating, celebrates every win', icon: '💪' },
      { id: 'drill_sergeant', name: 'Drill Sergeant', description: 'Tough love, no excuses, maximum accountability', icon: '🎖️' },
      { id: 'scientific', name: 'Scientific Advisor', description: 'Evidence-based, data-driven, precise explanations', icon: '🔬' },
      { id: 'casual', name: 'Casual Buddy', description: 'Relaxed and friendly, keeps it simple and fun', icon: '😎' },
    ]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
