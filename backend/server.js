require('dotenv').config();

// ── Startup validation ──
// Crash immediately if critical env vars are missing or weak
const REQUIRED_SECRETS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL'];
for (const key of REQUIRED_SECRETS) {
  if (!process.env[key]) {
    console.error(`[startup] FATAL: ${key} environment variable is not set`);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('[startup] FATAL: JWT_SECRET must be at least 32 characters');
  process.exit(1);
}
if (process.env.JWT_REFRESH_SECRET.length < 32) {
  console.error('[startup] FATAL: JWT_REFRESH_SECRET must be at least 32 characters');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const errorHandler = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── CORS ──
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: function (origin, callback) {
    // Allow server-to-server requests (health checks, Railway internals) — no Origin header
    if (!origin) return callback(null, true);
    // Block file:// origins in production
    if (origin === 'null') {
      if (isProduction) return callback(new Error('CORS: origin not allowed'));
      return callback(null, true);
    }

    const allowed = (process.env.FRONTEND_URL || '')
      .split(',')
      .map(u => u.trim())
      .filter(Boolean);

    // Railway automatically sets RAILWAY_PUBLIC_DOMAIN — use it to allow same-origin requests
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      const railwayUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
      if (!allowed.includes(railwayUrl)) allowed.push(railwayUrl);
    }

    if (allowed.length === 0) {
      if (isProduction) return callback(new Error('CORS: FRONTEND_URL not configured'));
      // Dev fallback
      allowed.push(
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:5173',
        'http://127.0.0.1:3000'
      );
    }

    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(generalLimiter);

// ── Static uploads with security headers ──
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  next();
}, express.static(uploadsDir));

// ── Health check ──
const db = require('./database/db');
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

// ── Routes ──
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/analysis',      require('./routes/analysis'));
app.use('/api/workouts',      require('./routes/workouts'));
app.use('/api/nutrition',     require('./routes/nutrition'));
app.use('/api/gamification',  require('./routes/gamification'));
app.use('/api/coach',         require('./routes/coach'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/tracking',      require('./routes/tracking'));
app.use('/api/wearable',      require('./routes/wearable'));

// ── Serve frontend (same origin, no CORS issues) ──
app.use(express.static(path.join(__dirname, '..')));

// ── Error handler (must be last) ──
app.use(errorHandler);

// ── Auto-migrations (safe to re-run) ──
async function runMigrations() {
  // On a fresh database (Railway) the core schema doesn't exist yet — run 001_init.sql first
  const { rows } = await db.query(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users'"
  );
  if (parseInt(rows[0].count) === 0) {
    console.log('[migrations] Fresh database detected — running initial schema...');
    const initSql = fs.readFileSync(path.join(__dirname, 'database/001_init.sql'), 'utf8');
    await db.query(initSql);
    console.log('[migrations] Initial schema created successfully');
  }

  const migrations = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL',

    `CREATE TABLE IF NOT EXISTS sleep_logs (
      id          SERIAL PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sleep_date  DATE NOT NULL,
      hours       NUMERIC(4,2) NOT NULL,
      quality     VARCHAR(20) NOT NULL DEFAULT 'good',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, sleep_date)
    )`,
    'ALTER TABLE sleep_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',

    `CREATE TABLE IF NOT EXISTS hydration_logs (
      id            SERIAL PRIMARY KEY,
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date      DATE NOT NULL,
      glasses_drunk INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, log_date)
    )`,

    `CREATE TABLE IF NOT EXISTS goal_weight (
      id         SERIAL PRIMARY KEY,
      user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      goal_kg    NUMERIC(5,2) NOT NULL,
      start_kg   NUMERIC(5,2),
      set_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS weight_log (
      id         SERIAL PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date   DATE NOT NULL,
      weight_kg  NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, log_date)
    )`,
    'ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',

    `CREATE TABLE IF NOT EXISTS measurement_logs (
      id         SERIAL PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date   DATE NOT NULL,
      chest      NUMERIC(5,2),
      waist      NUMERIC(5,2),
      hips       NUMERIC(5,2),
      arms       NUMERIC(5,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, log_date)
    )`,
    'ALTER TABLE measurement_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',

    `CREATE TABLE IF NOT EXISTS lift_log (
      id            SERIAL PRIMARY KEY,
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exercise_name VARCHAR(100) NOT NULL,
      log_date      DATE NOT NULL,
      weight_kg     NUMERIC(6,2) NOT NULL,
      reps          INTEGER NOT NULL,
      e1rm          NUMERIC(6,2),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, exercise_name, log_date)
    )`,
    'ALTER TABLE lift_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',

    // Persona tracking table (safety — also in 001_init.sql)
    `CREATE TABLE IF NOT EXISTS user_personas_used (
      id           SERIAL PRIMARY KEY,
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona      VARCHAR(50) NOT NULL,
      first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, persona)
    )`,

    // How-to guide columns on exercises table
    'ALTER TABLE exercises ADD COLUMN IF NOT EXISTS how_to_steps JSONB NULL',
    'ALTER TABLE exercises ADD COLUMN IF NOT EXISTS how_to_tip TEXT NULL',

    // Meal plan templates
    `CREATE TABLE IF NOT EXISTS meals (
      id        SERIAL PRIMARY KEY,
      name      VARCHAR(100) NOT NULL,
      icon      VARCHAR(10),
      meal_type VARCHAR(20)  NOT NULL,
      diet      VARCHAR(20)  NOT NULL DEFAULT 'standard',
      foods     JSONB        NOT NULL,
      is_active BOOLEAN      DEFAULT true
    )`,

    // Indexes for frequently queried user_id columns on tracking tables
    'CREATE INDEX IF NOT EXISTS idx_sleep_logs_user_id ON sleep_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_hydration_logs_user_id ON hydration_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_weight_log_user_id ON weight_log(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_measurement_logs_user_id ON measurement_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_lift_log_user_id ON lift_log(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_id ON coach_conversations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_analysis_scans_user_id ON analysis_scans(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_food_log_user_id ON food_log(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',

    `CREATE TABLE IF NOT EXISTS wearable_sessions (
      id           SERIAL PRIMARY KEY,
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_date DATE NOT NULL,
      steps        INTEGER NOT NULL DEFAULT 0,
      hr_avg       INTEGER,
      hr_readings  JSONB,
      calories     NUMERIC(6,2),
      active_secs  INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS idx_wearable_sessions_user_id ON wearable_sessions(user_id)',
  ];

  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (err) {
      console.warn('Migration notice:', err.message);
    }
  }
}

// ── Exercise how-to seed data ──
const HOW_TO_DATA = {
  'Bench Press':               { steps: ['Lie on a flat bench, feet flat on the floor.', 'Grip the barbell just wider than shoulder-width.', 'Unrack and lower the bar to your mid-chest.', 'Pause briefly, then press explosively back up.', 'Lock out at the top without fully locking elbows.'], tip: 'Keep your shoulder blades pinched together throughout to protect your shoulder joints.' },
  'Incline Dumbbell Press':    { steps: ['Set bench to 30-45° incline.', 'Hold dumbbells at shoulder level with palms forward.', 'Press the dumbbells up and slightly inward.', 'Control the descent back to shoulder height.', 'Keep elbows at 45° — not flared wide.'], tip: 'A lower incline angle shifts more focus to upper chest and less to the front delts.' },
  'Cable Flyes':               { steps: ['Set cables to chest height, stand centred between them.', 'Hold handles with a slight bend in your elbows.', 'Step forward to create tension on the cables.', 'Squeeze your arms together in a wide arc in front of you.', 'Slowly return with control — fight the cables back.'], tip: 'Think of hugging a large tree — the arc motion matters more than the weight used.' },
  'Push-Ups':                  { steps: ['Start in a high plank with hands just outside shoulder-width, arms straight.', 'Brace your core so your body forms one rigid line head to heels.', 'Lower your chest by bending elbows at roughly 45° from your body.', 'Stop just before your chest touches the floor.', 'Press through your palms explosively back to the starting position.'], tip: "Can't do full push-ups? Drop to your knees — keep the same rigid body alignment." },
  'Dips':                      { steps: ['Grip parallel bars with arms straight, lean slightly forward.', 'Lower your body by bending your elbows.', 'Stop when your upper arms are parallel to the floor.', 'Keep your elbows close to your sides.', 'Press back up to starting position without shrugging your shoulders.'], tip: 'Leaning forward targets chest more; staying upright targets triceps.' },
  'Pull-Ups':                  { steps: ['Hang from a bar with hands slightly wider than shoulders, palms facing away.', 'Engage your core and squeeze shoulder blades down and back.', 'Pull your chest toward the bar by driving elbows down.', 'Continue until your chin clears the bar.', 'Lower with control until arms are fully extended.'], tip: 'Initiate from your shoulder blades — not your arms — for full lat engagement.' },
  'Barbell Rows':              { steps: ['Stand feet hip-width, hinge forward until torso is near parallel to the floor.', 'Hold the barbell with an overhand grip, arms straight.', 'Pull the bar to your lower ribcage.', 'Squeeze your shoulder blades together at the top.', "Lower with control — don't drop the bar."], tip: 'Brace your core hard to protect your lower back throughout every rep.' },
  'Lat Pulldown':              { steps: ['Sit and tuck your legs under the pad, lean back slightly.', 'Grip the bar just wider than shoulder-width.', 'Initiate by pulling your shoulder blades down and back.', 'Pull the bar to your upper chest.', 'Control the bar back up until arms are nearly straight.'], tip: "Lead with your elbows — imagine trying to put them in your back pockets." },
  'Seated Cable Rows':         { steps: ['Sit upright with feet on the platform, slight knee bend.', 'Grip the handle with a neutral grip, arms straight.', 'Pull the handle to your lower sternum.', 'Squeeze your shoulder blades together and hold 1 second.', "Return with control — don't slump forward."], tip: "Don't lean back excessively — the power should come from your back, not body momentum." },
  'Face Pulls':                { steps: ['Set the cable to head height with a rope attachment.', 'Step back and grip both rope ends, palms facing inward.', 'Brace your core and keep a neutral spine.', 'Pull the rope toward your face, flaring elbows wide.', 'Hold briefly at your ears and return with control.'], tip: 'These are excellent for shoulder health — never skip them in a pushing-heavy programme.' },
  'Overhead Press':            { steps: ['Stand feet hip-width, barbell at upper chest level.', 'Grip just outside shoulder-width.', 'Brace your core and glutes hard.', 'Press the bar straight up overhead until arms lock out.', 'Lower back to the collarbone with control.'], tip: 'Push your head forward slightly through your arms at the top — press in a straight vertical line.' },
  'Lateral Raises':            { steps: ['Stand holding dumbbells at your sides.', 'Keep a slight bend in your elbows throughout.', 'Raise the dumbbells out to the sides to shoulder height.', 'Lead with your elbows, not your wrists.', 'Lower with control over 2-3 seconds.'], tip: 'Use lighter weight than you think — most people use too much and recruit the traps instead.' },
  'Front Raises':              { steps: ['Stand holding dumbbells at your thighs, palms facing down.', 'Keeping arms nearly straight, lift one or both arms forward.', 'Raise to shoulder height — no higher.', 'Hold briefly at the top.', 'Lower slowly with control.'], tip: 'Alternate arms if using heavier weight to reduce swinging momentum.' },
  'Reverse Flyes':             { steps: ['Hinge forward with flat back at about 45°.', 'Hold dumbbells beneath you, palms facing each other.', 'Keeping a slight elbow bend, raise arms out to the sides.', 'Squeeze your rear delts hard at the top.', 'Lower slowly — control beats momentum here.'], tip: 'This is a small-muscle movement — go light and focus entirely on the squeeze.' },
  'Arnold Press':              { steps: ['Sit with dumbbells at shoulder height, palms facing toward you.', 'As you press up, rotate your palms to face outward.', 'Extend fully at the top.', 'Reverse the rotation as you lower back down.', 'Complete the full arc on every single rep.'], tip: "Don't rush the rotation — it's what makes this exercise different from a standard press." },
  'Squats':                    { steps: ['Bar on upper traps, feet shoulder-width, toes slightly out.', 'Brace your core and breathe in before descending.', 'Push your hips back, then bend your knees.', 'Descend until thighs are parallel to the floor.', 'Drive through your whole foot back to standing.'], tip: 'If your torso folds forward, widen your stance or work on ankle mobility.' },
  'Bodyweight Squats':         { steps: ['Stand with feet shoulder-width apart, toes pointed slightly out.', 'Brace your core, keep your chest tall and gaze forward.', 'Push hips back and bend your knees to lower down.', 'Descend until thighs are parallel to the floor (or as low as comfortable).', 'Drive through your heels to stand back up fully.'], tip: "Keep knees tracking over your toes — don't let them cave inward." },
  'Romanian Deadlifts':        { steps: ['Stand holding the barbell at hip height, feet hip-width.', 'Push your hips back while keeping the bar close to your legs.', 'Lower until you feel a strong hamstring stretch (around mid-shin).', 'Drive your hips forward to return to standing.', 'Keep your back flat and core braced throughout.'], tip: 'This is about the hip hinge, not bending at the waist — the hamstring stretch is the goal.' },
  'Leg Press':                 { steps: ['Sit in the machine with feet shoulder-width on the platform.', 'Lower the platform by bending your knees to 90°.', 'Press through your heels to extend your legs.', "Don't lock your knees out fully at the top.", 'Control the descent every rep.'], tip: 'Higher foot placement targets glutes; lower placement hits the quads harder.' },
  'Leg Curls':                 { steps: ['Lie prone on the machine with the pad just above your heels.', 'Hold the handles and keep your hips on the bench.', 'Curl your heels toward your glutes.', 'Squeeze briefly at the top of the movement.', 'Lower with a slow 2-3 second count.'], tip: 'Point your toes slightly inward or outward to shift emphasis between hamstring heads.' },
  'Calf Raises':               { steps: ['Stand on the edge of a step with heels hanging off.', 'Lower your heels below step level for a full stretch.', 'Rise up onto the balls of your feet as high as possible.', 'Pause at the top and squeeze your calves.', 'Lower back down under full control.'], tip: "Calves respond best to high reps and full range of motion — don't bounce." },
  'Lunges':                    { steps: ['Stand with feet together, hands on hips or at your sides.', 'Step one foot forward about two feet.', 'Lower your back knee toward the floor.', 'Keep your front shin vertical and chest upright.', 'Push through your front heel to return to standing.'], tip: "Don't let your front knee cave inward — track it over your second toe." },
  'Barbell Curls':             { steps: ['Stand holding a barbell with underhand grip, hands shoulder-width.', 'Keep your elbows tucked to your sides throughout.', 'Curl the bar up by contracting your biceps.', 'Squeeze at the top for one second.', 'Lower in 2-3 seconds — resist gravity on the way down.'], tip: "Minimal body swing — if you're swinging, the weight is too heavy." },
  'Tricep Pushdowns':          { steps: ['Stand at a cable machine with the attachment at head height.', 'Grip the bar or rope with elbows at your sides.', 'Push down until your arms are fully extended.', 'Hold for a moment and squeeze your triceps.', 'Control the return slowly.'], tip: "Keep your elbows pinned — they shouldn't drift forward during the push." },
  'Hammer Curls':              { steps: ['Stand holding dumbbells with palms facing each other (neutral grip).', 'Keep elbows tucked to your sides.', 'Curl one or both dumbbells up toward your shoulder.', 'Pause at the top, then lower with control.', 'The neutral grip works the brachialis and forearms hard.'], tip: 'Alternate arms to maintain focus and prevent shoulder rocking.' },
  'Skull Crushers':            { steps: ['Lie on a flat bench holding a barbell or dumbbells above your chest.', 'Keep your upper arms vertical and pointed at the ceiling.', 'Bend only at the elbows and lower the weight toward your forehead.', 'Stop just before touching your forehead.', 'Extend back to the starting position.'], tip: "Don't let your elbows flare out — keep them pointing straight up." },
  'Concentration Curls':       { steps: ['Sit on a bench, one dumbbell in hand.', 'Brace your elbow against the inside of your thigh.', 'Let your arm hang straight down.', 'Curl the dumbbell up by contracting your bicep.', 'Squeeze hard at the top and lower slowly.'], tip: 'This isolates the bicep peak — slow and controlled wins every time.' },
  'Plank':                     { steps: ['Start face-down with forearms flat, elbows directly under your shoulders.', 'Curl your toes under and lift your hips off the ground.', 'Form a straight line from head to heels — no sagging or piking.', 'Squeeze your glutes and brace your abs as hard as you can.', 'Breathe steadily and hold for the full target time.'], tip: 'Imagine pulling your elbows toward your feet — this fires the core much harder.' },
  'Hanging Leg Raises':        { steps: ['Hang from a pull-up bar with an overhand grip.', 'Keep your legs together and core tight.', 'Raise your legs until parallel to the floor (or higher).', "Control the descent — don't swing.", 'Exhale as you raise, inhale on the way down.'], tip: 'Bend your knees to reduce difficulty; raise legs all the way to the bar to increase it.' },
  'Cable Crunches':            { steps: ['Kneel facing the cable machine with a rope attached above.', 'Hold the rope at each side of your head.', 'Hinge at the hips and curl your elbows toward your knees.', 'Feel a strong ab contraction at the bottom.', 'Return to upright with control.'], tip: "The movement comes from your abs — don't pull with your arms or hips." },
  'Russian Twists':            { steps: ['Sit with knees bent, feet lifted slightly, leaning back 45°.', 'Clasp your hands or hold a weight at your chest.', 'Rotate your torso to one side as far as comfortable.', "Rotate to the other side — that's one rep.", 'Keep your abs braced throughout.'], tip: 'Add a dumbbell or plate when bodyweight becomes too easy.' },
  'Dead Bug':                  { steps: ['Lie on your back with arms pointing up and knees bent 90° in the air.', 'Brace your lower back flat against the floor.', 'Slowly lower one arm overhead and extend the opposite leg down.', 'Return both to the start before switching sides.', 'Never let your lower back arch off the floor.'], tip: 'Keep your spine completely flat — quality over speed every time.' },
  'Diamond Push-Ups':          { steps: ['Start in a push-up position with hands forming a diamond beneath your chest.', 'Keep your body in a rigid line from head to heels.', 'Lower your chest to your hands.', 'Press back up fully extending your arms.', 'Keep elbows pointing backward, not flared out.'], tip: 'The narrow hand position maximises tricep activation — expect fewer reps than a regular push-up.' },
  'Wide Push-Ups':             { steps: ['Start in a push-up position with hands wider than shoulder-width.', 'Lower your chest toward the floor with elbows flaring at 70-80°.', "Go as low as comfortable without letting hips sag.", 'Press back up through the chest.', 'Pause briefly at the top to feel the chest contraction.'], tip: 'The wider your hands, the more you activate the outer chest fibres.' },
  'Decline Push-Ups':          { steps: ['Place your feet on an elevated surface (chair or step).', 'Walk your hands out to shoulder-width.', 'Lower your chest toward the floor.', 'Press up with emphasis on the upper chest and front delts.', "Keep your core braced so your hips don't sag."], tip: 'The higher your feet, the more upper chest and shoulder involvement.' },
  'Pike Push-Ups':             { steps: ['Start in a downward dog position with hips high and arms straight.', 'Hands shoulder-width, elbows track over your wrists.', 'Bend your elbows to lower your head toward the floor.', 'Press back up until arms are straight.', 'Keep your legs as straight as comfortable.'], tip: 'This mimics the overhead press movement — great shoulder builder without equipment.' },
  'Supermans':                 { steps: ['Lie face-down on the floor with arms extended overhead.', 'Keep your neck neutral — look at the floor.', 'Simultaneously lift your arms, chest, and legs off the ground.', 'Hold the raised position for 1-2 seconds.', 'Lower slowly and repeat.'], tip: "Don't strain your neck by looking forward — keep your gaze down to maintain alignment." },
  'Reverse Snow Angels':       { steps: ['Lie face down with arms at your sides, palms facing the floor.', 'Lift your arms slightly off the ground.', 'Sweep your arms overhead in a wide arc like a reverse snow angel.', 'Return to the start position.', 'Keep your chest slightly lifted throughout.'], tip: 'Go slowly — the muscles here are small and fatigue quickly.' },
  'Prone Y Raises':            { steps: ['Lie face down with arms extended in a Y shape at 45° overhead.', 'Keep your thumbs pointing up toward the ceiling.', 'Lift your arms as high as you can off the floor.', 'Hold for 1 second at the top.', 'Lower slowly and reset.'], tip: 'Just bodyweight is plenty — these muscles are small but important for shoulder health.' },
  'Bird Dogs':                 { steps: ['Start on all fours with hands under shoulders and knees under hips.', 'Brace your core to keep your back flat.', 'Extend your right arm forward and left leg back simultaneously.', 'Hold for 2-3 seconds without rotating your hips.', 'Return and repeat on the other side.'], tip: 'Imagine balancing a glass of water on your lower back — no tilting allowed.' },
  'Towel Rows':                { steps: ['Loop a towel around a door handle at waist height.', 'Hold both ends and lean back with straight arms.', 'Brace your core and pull your chest toward the door.', 'Squeeze your shoulder blades at the top.', 'Lower back to the start with control.'], tip: 'The more horizontal your body angle, the harder the exercise becomes.' },
  'Arm Circles':               { steps: ['Stand with feet shoulder-width and arms extended to the sides.', 'Make small circles forward for the target reps.', 'Then make small circles backward for the same count.', 'Gradually increase circle size on each set.', 'Keep your core engaged and shoulders relaxed.'], tip: 'Great as a warm-up or active recovery — focus on the burn in the lateral delts.' },
  'Wall Handstand Hold':       { steps: ['Stand facing away from a wall, place hands on the floor about 1 foot away.', 'Kick up one foot at a time until your heels touch the wall.', 'Keep your body in a straight line from wrist to heel.', 'Engage your core and squeeze your glutes.', 'Hold for the target time then carefully lower down.'], tip: "Don't arch your back — a hollow body position is safer and more effective." },
  'Prone I-Y-T Raises':        { steps: ['Lie face down and extend arms in an I position overhead.', 'Lift arms off the floor and hold 1-2 seconds, then lower.', 'Spread arms to a Y position and repeat the lift.', 'Finally spread to a T position and repeat.', 'Each letter is one set — use light or no weight.'], tip: 'These target the lower and mid traps which are crucial for long-term shoulder health.' },
  'Lateral Plank Walk':        { steps: ['Start in a high plank position with core braced.', 'Step your right hand and right foot out to the right.', 'Follow with your left hand and left foot to restore the plank.', 'Take 4-6 steps right, then return left.', 'Keep your hips low and level throughout.'], tip: 'The smaller your steps, the more shoulder stability is required.' },
  'Glute Bridges':             { steps: ['Lie on your back with knees bent and feet flat on the floor.', 'Place arms at your sides for stability.', 'Drive through your heels to lift your hips toward the ceiling.', 'Squeeze your glutes hard at the top for 1-2 seconds.', 'Lower your hips slowly back to the floor.'], tip: 'Add a resistance band around your knees or a weight on your hips to increase difficulty.' },
  'Bulgarian Split Squats':    { steps: ['Stand 2-3 feet in front of a bench or chair.', 'Place one foot behind you on the elevated surface.', 'Lower your back knee toward the floor.', 'Keep your front shin as vertical as possible.', 'Drive through your front heel to return to the top.'], tip: 'Expect significant muscle soreness for beginners — one of the most effective leg exercises.' },
  'Wall Sits':                 { steps: ['Stand with your back against a wall.', 'Slide down until your thighs are parallel to the floor.', 'Keep your feet flat and knees directly over your ankles.', 'Push your lower back firmly into the wall.', 'Hold for the target time breathing steadily.'], tip: 'Add a dumbbell on your thighs or extend one leg to make it harder.' },
  'Single-Leg Calf Raises':    { steps: ['Stand on one foot at the edge of a step.', 'Let your heel drop below step level for a full stretch.', 'Rise up as high as possible on the ball of your foot.', 'Pause and squeeze your calf at the top.', 'Lower slowly for 2-3 seconds.'], tip: 'Much harder than bilateral — use a wall for balance until you build strength.' },
  'Tricep Dips (Chair)':       { steps: ['Sit on the edge of a sturdy chair with hands beside your hips.', 'Slide your hips off the chair and support yourself on your arms.', 'Lower your body by bending your elbows to 90°.', 'Keep your back close to the chair throughout.', 'Press back up until arms are straight.'], tip: 'Straightening your legs makes this harder — bent knees is the beginner modification.' },
  'Chin-Up Hold (Door Frame)': { steps: ['Grip the top of a door frame with both hands, palms facing you.', 'Hang with arms straight to start.', 'Pull yourself up until your chin is at frame height.', 'Hold the top position for the target time.', 'Lower slowly with control.'], tip: "Keep your shoulder blades down and back — don't let them shrug up." },
  'Isometric Bicep Curl (Towel)': { steps: ['Stand on the centre of a towel holding both ends.', 'Adopt a curl position with elbows at 90°.', 'Pull the towel upward with both hands as hard as you can.', "Your arms won't move — the tension is the exercise.", 'Hold for the target time and breathe steadily.'], tip: 'Vary your elbow angle each set to build strength at different positions.' },
  'Plank Shoulder Taps':       { steps: ['Start in a high plank with hands under your shoulders.', 'Brace your core and keep your hips square.', 'Lift one hand to tap the opposite shoulder.', 'Return it and repeat on the other side.', 'The goal: absolutely no hip rotation.'], tip: 'Widen your feet for more stability if keeping the hips still is challenging.' },
  'Crunches':                  { steps: ['Lie on your back with knees bent and feet flat.', 'Place fingertips behind your head without pulling your neck.', 'Engage your abs and curl your shoulder blades off the floor.', 'Exhale at the top of the movement.', "Lower with control — don't let your head crash down."], tip: 'Only your shoulder blades lift — this is not a sit-up. Keep your lower back flat throughout.' },
  'Bicycle Crunches':          { steps: ['Lie on your back with hands behind your head and legs raised.', 'Bring your right elbow toward your left knee while extending the right leg.', 'Switch sides in a pedalling motion.', "Rotate from your core — don't pull your head with your hands.", 'Keep the movement controlled.'], tip: 'Slow bicycle crunches beat fast ones every time for oblique activation.' },
  'Mountain Climbers':         { steps: ['Start in a high plank position, core braced.', 'Drive your right knee toward your chest.', 'Return it and immediately drive your left knee in.', 'Alternate legs at a steady pace.', "Keep your hips low — don't let them pike up."], tip: 'Slow = core exercise. Fast = cardio. Choose your goal and pace accordingly.' },
  'Leg Raises':                { steps: ['Lie flat on your back with legs straight and hands under your lower back.', 'Press your lower back against the floor throughout.', 'Raise both legs to 90° while keeping them straight.', 'Lower slowly — stop just before your heels touch the floor.', "That's one rep — don't lose lower back contact."], tip: 'The lower you lower your legs, the harder this gets. Go only as low as you can with a flat back.' },
};

async function seedExerciseHowTo() {
  // Check if already seeded (any exercise has how_to_tip set)
  const check = await db.query('SELECT COUNT(*) FROM exercises WHERE how_to_tip IS NOT NULL');
  if (parseInt(check.rows[0].count) > 0) return;

  for (const [name, data] of Object.entries(HOW_TO_DATA)) {
    await db.query(
      'UPDATE exercises SET how_to_steps = $1, how_to_tip = $2 WHERE name = $3',
      [JSON.stringify(data.steps), data.tip, name]
    );
  }
  console.log('[seed] Exercise how-to data seeded successfully');
}

// ── Meal seed data ──
const MEAL_DATA = [
  // breakfast — standard
  { name: 'Greek Yogurt Parfait',    icon: '🥣', meal_type: 'breakfast', diet: 'standard',    foods: [{ name: 'Greek Yogurt', portion: '200g', icon: '🥛', protein: 20, carbs: 8, fats: 5, calories: 157 }, { name: 'Mixed Berries', portion: '100g', icon: '🍓', protein: 1, carbs: 14, fats: 0, calories: 57 }, { name: 'Granola', portion: '40g', icon: '🌾', protein: 4, carbs: 28, fats: 6, calories: 180 }] },
  { name: 'Protein Oatmeal Bowl',    icon: '🥣', meal_type: 'breakfast', diet: 'standard',    foods: [{ name: 'Oatmeal', portion: '80g dry', icon: '🥣', protein: 10, carbs: 54, fats: 6, calories: 304 }, { name: 'Banana', portion: '1 medium', icon: '🍌', protein: 1, carbs: 27, fats: 0, calories: 105 }, { name: 'Almond Butter', portion: '2 tbsp', icon: '🥜', protein: 7, carbs: 6, fats: 18, calories: 196 }] },
  { name: 'Eggs & Avocado Toast',    icon: '🍳', meal_type: 'breakfast', diet: 'standard',    foods: [{ name: 'Scrambled Eggs', portion: '3 large', icon: '🥚', protein: 18, carbs: 2, fats: 15, calories: 210 }, { name: 'Whole Grain Toast', portion: '2 slices', icon: '🍞', protein: 8, carbs: 26, fats: 2, calories: 160 }, { name: 'Avocado', portion: '½ medium', icon: '🥑', protein: 2, carbs: 6, fats: 15, calories: 160 }] },
  // lunch — standard
  { name: 'Grilled Chicken Salad',   icon: '🥗', meal_type: 'lunch', diet: 'standard',        foods: [{ name: 'Grilled Chicken Breast', portion: '150g', icon: '🍗', protein: 46, carbs: 0, fats: 5, calories: 248 }, { name: 'Mixed Greens', portion: '100g', icon: '🥬', protein: 2, carbs: 4, fats: 0, calories: 20 }, { name: 'Olive Oil Dressing', portion: '2 tbsp', icon: '🫒', protein: 0, carbs: 0, fats: 28, calories: 240 }, { name: 'Cherry Tomatoes', portion: '80g', icon: '🍅', protein: 1, carbs: 4, fats: 0, calories: 18 }] },
  { name: 'Salmon Rice Bowl',        icon: '🍱', meal_type: 'lunch', diet: 'standard',        foods: [{ name: 'Grilled Salmon', portion: '140g', icon: '🐟', protein: 28, carbs: 0, fats: 18, calories: 290 }, { name: 'Brown Rice', portion: '150g cooked', icon: '🍚', protein: 4, carbs: 36, fats: 2, calories: 168 }, { name: 'Steamed Broccoli', portion: '100g', icon: '🥦', protein: 3, carbs: 7, fats: 0, calories: 34 }] },
  { name: 'Turkey Wrap',             icon: '🌯', meal_type: 'lunch', diet: 'standard',        foods: [{ name: 'Turkey Breast', portion: '120g', icon: '🦃', protein: 36, carbs: 0, fats: 2, calories: 162 }, { name: 'Whole Wheat Wrap', portion: '1 large', icon: '🫓', protein: 6, carbs: 36, fats: 4, calories: 200 }, { name: 'Hummus', portion: '40g', icon: '🥣', protein: 3, carbs: 6, fats: 4, calories: 66 }, { name: 'Mixed Vegetables', portion: '80g', icon: '🥒', protein: 2, carbs: 8, fats: 0, calories: 35 }] },
  // dinner — standard
  { name: 'Steak & Sweet Potato',    icon: '🥩', meal_type: 'dinner', diet: 'standard',       foods: [{ name: 'Lean Beef Steak', portion: '180g', icon: '🥩', protein: 50, carbs: 0, fats: 14, calories: 330 }, { name: 'Sweet Potato', portion: '200g', icon: '🍠', protein: 4, carbs: 40, fats: 0, calories: 172 }, { name: 'Asparagus', portion: '100g', icon: '🌿', protein: 2, carbs: 4, fats: 0, calories: 20 }] },
  { name: 'Chicken Stir-Fry',        icon: '🍳', meal_type: 'dinner', diet: 'standard',       foods: [{ name: 'Chicken Thigh', portion: '160g', icon: '🍗', protein: 38, carbs: 0, fats: 12, calories: 264 }, { name: 'Jasmine Rice', portion: '150g cooked', icon: '🍚', protein: 4, carbs: 45, fats: 1, calories: 195 }, { name: 'Stir-Fry Vegetables', portion: '150g', icon: '🥦', protein: 4, carbs: 12, fats: 2, calories: 60 }, { name: 'Teriyaki Sauce', portion: '30ml', icon: '🥢', protein: 1, carbs: 8, fats: 0, calories: 35 }] },
  { name: 'Baked Fish & Quinoa',     icon: '🐟', meal_type: 'dinner', diet: 'standard',       foods: [{ name: 'Baked Cod', portion: '170g', icon: '🐟', protein: 35, carbs: 0, fats: 2, calories: 160 }, { name: 'Quinoa', portion: '150g cooked', icon: '🌾', protein: 6, carbs: 30, fats: 3, calories: 180 }, { name: 'Roasted Vegetables', portion: '150g', icon: '🥕', protein: 3, carbs: 18, fats: 5, calories: 120 }] },
  // snack — standard
  { name: 'Protein Shake',           icon: '🥤', meal_type: 'snack', diet: 'standard',        foods: [{ name: 'Whey Protein', portion: '1 scoop', icon: '🥛', protein: 25, carbs: 3, fats: 2, calories: 130 }, { name: 'Banana', portion: '1 small', icon: '🍌', protein: 1, carbs: 20, fats: 0, calories: 80 }] },
  { name: 'Nuts & Fruit',            icon: '🥜', meal_type: 'snack', diet: 'standard',        foods: [{ name: 'Mixed Nuts', portion: '30g', icon: '🌰', protein: 6, carbs: 6, fats: 16, calories: 180 }, { name: 'Apple', portion: '1 medium', icon: '🍎', protein: 0, carbs: 25, fats: 0, calories: 95 }] },
  { name: 'Cottage Cheese Bowl',     icon: '🧀', meal_type: 'snack', diet: 'standard',        foods: [{ name: 'Cottage Cheese', portion: '150g', icon: '🧀', protein: 17, carbs: 5, fats: 6, calories: 147 }, { name: 'Pineapple', portion: '80g', icon: '🍍', protein: 0, carbs: 11, fats: 0, calories: 40 }] },
  // lunch — vegetarian
  { name: 'Buddha Bowl',             icon: '🥗', meal_type: 'lunch', diet: 'vegetarian',      foods: [{ name: 'Chickpeas', portion: '150g', icon: '🫘', protein: 15, carbs: 40, fats: 4, calories: 246 }, { name: 'Quinoa', portion: '150g cooked', icon: '🌾', protein: 6, carbs: 30, fats: 3, calories: 180 }, { name: 'Roasted Vegetables', portion: '150g', icon: '🥕', protein: 3, carbs: 18, fats: 5, calories: 120 }, { name: 'Tahini Dressing', portion: '30g', icon: '🥜', protein: 3, carbs: 3, fats: 9, calories: 100 }] },
  // dinner — vegetarian
  { name: 'Tofu Stir-Fry',          icon: '🍳', meal_type: 'dinner', diet: 'vegetarian',     foods: [{ name: 'Firm Tofu', portion: '200g', icon: '🧈', protein: 20, carbs: 4, fats: 12, calories: 190 }, { name: 'Brown Rice', portion: '150g cooked', icon: '🍚', protein: 4, carbs: 36, fats: 2, calories: 168 }, { name: 'Mixed Vegetables', portion: '200g', icon: '🥦', protein: 6, carbs: 16, fats: 2, calories: 80 }] },
];

async function seedMeals() {
  const check = await db.query('SELECT COUNT(*) FROM meals');
  if (parseInt(check.rows[0].count) > 0) return;
  for (const m of MEAL_DATA) {
    await db.query(
      'INSERT INTO meals (name, icon, meal_type, diet, foods) VALUES ($1,$2,$3,$4,$5)',
      [m.name, m.icon, m.meal_type, m.diet, JSON.stringify(m.foods)]
    );
  }
  console.log('[seed] Meal data seeded successfully');
}

// ── Process error handlers ──
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

// ── Start ──
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
  console.log(`FiX-it API running on http://localhost:${PORT}`);
  console.log(`Open app: http://localhost:${PORT}/index.html`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  await runMigrations();
  await seedExerciseHowTo();
  await seedMeals();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[startup] Port ${PORT} is already in use`);
    process.exit(1);
  }
  throw err;
});

// ── Graceful shutdown ──
function shutdown() {
  console.log('[shutdown] Received shutdown signal, closing server...');
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    db.pool.end(() => {
      console.log('[shutdown] DB pool closed');
      process.exit(0);
    });
  });
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
