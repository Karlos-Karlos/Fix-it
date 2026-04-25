-- ============================================================================
-- FiX-it — Initial Database Migration
-- ============================================================================
-- File:    001_init.sql
-- Purpose: Complete schema, indexes, triggers, and seed data
-- Source of truth: frontend (script.js) for all seed data
-- DB:      PostgreSQL 15+
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PART 1: REFERENCE / LOOKUP TABLES (no foreign keys to user tables)
-- ============================================================================

-- 1. foods — Master food database (45 items from LOCAL_FOOD_DATABASE)
CREATE TABLE foods (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)    NOT NULL UNIQUE,
    calories        INT             NOT NULL,
    protein         DECIMAL(6,2)    NOT NULL,
    carbs           DECIMAL(6,2)    NOT NULL,
    fats            DECIMAL(6,2)    NOT NULL,
    fiber           DECIMAL(6,2)    NULL,
    sugar           DECIMAL(6,2)    NULL,
    sodium          DECIMAL(6,2)    NULL,
    portion         VARCHAR(50)     NOT NULL,
    portion_grams   INT             NULL,
    icon            VARCHAR(10)     NULL,
    category        VARCHAR(50)     NULL,
    tags            VARCHAR(255)    NULL,
    is_active       BOOLEAN         DEFAULT true,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- 2. exercises — Master exercise database (63 exercises: 31 gym + 32 home)
CREATE TABLE exercises (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)    NOT NULL,
    muscle_group    VARCHAR(30)     NOT NULL,
    equipment_type  VARCHAR(20)     NOT NULL,
    default_sets    INT             NOT NULL,
    default_reps    VARCHAR(20)     NOT NULL,
    target_muscles  JSON            NOT NULL,
    difficulty      VARCHAR(20)     NULL,
    instructions    TEXT            NULL,
    video_url       VARCHAR(500)    NULL,
    is_active       BOOLEAN         DEFAULT true,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- 3. achievements — Badge definitions (14 from ACHIEVEMENTS)
CREATE TABLE achievements (
    id              VARCHAR(50)     PRIMARY KEY,
    title           VARCHAR(100)    NOT NULL,
    icon            VARCHAR(10)     NOT NULL,
    description     VARCHAR(255)    NOT NULL,
    category        VARCHAR(30)     NULL,
    xp_reward       INT             DEFAULT 0,
    sort_order      INT             DEFAULT 0,
    is_active       BOOLEAN         DEFAULT true
);

-- 4. challenges — Weekly challenge pool (8 from CHALLENGE_POOL)
CREATE TABLE challenges (
    id              VARCHAR(50)     PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL,
    icon            VARCHAR(10)     NOT NULL,
    target          INT             NOT NULL,
    metric_key      VARCHAR(50)     NOT NULL,
    xp_reward       INT             DEFAULT 25,
    category        VARCHAR(30)     NULL,
    is_active       BOOLEAN         DEFAULT true
);

-- 5. levels — Rank progression thresholds (20 levels)
CREATE TABLE levels (
    level           INT             PRIMARY KEY,
    xp_required     INT             NOT NULL,
    rank_name       VARCHAR(50)     NOT NULL
);

-- 6. workout_splits — Split templates (4 from splitTemplates)
CREATE TABLE workout_splits (
    id              VARCHAR(30)     PRIMARY KEY,
    name            VARCHAR(50)     NOT NULL,
    description     VARCHAR(255)    NULL,
    days_pattern    JSON            NOT NULL,
    day_configs     JSON            NOT NULL,
    recommended_for VARCHAR(100)    NULL,
    is_active       BOOLEAN         DEFAULT true
);

-- ============================================================================
-- PART 2: USER TABLES
-- ============================================================================

-- 7. users — Core authentication and profile
CREATE TABLE users (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                   VARCHAR(255)    UNIQUE NOT NULL,
    password_hash           VARCHAR(255)    NOT NULL,
    email_verified          BOOLEAN         DEFAULT false,
    email_verified_at       TIMESTAMP       NULL,
    display_name            VARCHAR(100)    NULL,
    gender                  VARCHAR(20)     NULL,
    height                  DECIMAL(5,2)    NULL,
    weight                  DECIMAL(5,2)    NULL,
    age_range               VARCHAR(10)     NULL,
    activity_level          VARCHAR(20)     NULL,
    fitness_goal            VARCHAR(20)     NULL,
    experience_level        VARCHAR(20)     DEFAULT 'intermediate',
    avatar_url              TEXT            NULL,
    role                    VARCHAR(20)     DEFAULT 'user',
    failed_login_attempts   INT             DEFAULT 0,
    locked_until            TIMESTAMP       NULL,
    last_login_at           TIMESTAMP       NULL,
    created_at              TIMESTAMP       DEFAULT NOW(),
    updated_at              TIMESTAMP       DEFAULT NOW()
);

-- 8. user_preferences — Settings and app preferences
CREATE TABLE user_preferences (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    theme           VARCHAR(20)     DEFAULT 'dark',
    coach_persona   VARCHAR(20)     DEFAULT 'encouraging',
    created_at      TIMESTAMP       DEFAULT NOW(),
    updated_at      TIMESTAMP       DEFAULT NOW()
);

-- 9. user_gamification — Points, streaks, counters
CREATE TABLE user_gamification (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    total_xp                INT         DEFAULT 0,
    current_streak          INT         DEFAULT 0,
    best_streak             INT         DEFAULT 0,
    total_workouts          INT         DEFAULT 0,
    total_analyses          INT         DEFAULT 0,
    nutrition_views         INT         DEFAULT 0,
    coach_questions         INT         DEFAULT 0,
    meal_plans_generated    INT         DEFAULT 0,
    food_scanned            BOOLEAN     DEFAULT false,
    first_compare_done      BOOLEAN     DEFAULT false,
    last_workout_date       DATE        NULL,
    updated_at              TIMESTAMP   DEFAULT NOW()
);

-- ============================================================================
-- PART 3: USER-DEPENDENT TABLES
-- ============================================================================

-- 10. user_achievements — Unlocked badges per user
CREATE TABLE user_achievements (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  VARCHAR(50)     NOT NULL REFERENCES achievements(id),
    unlocked_at     TIMESTAMP       DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- 11. user_personas_used — Coach personas tried (for achievement tracking)
CREATE TABLE user_personas_used (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona         VARCHAR(20)     NOT NULL,
    first_used_at   TIMESTAMP       DEFAULT NOW(),
    UNIQUE(user_id, persona)
);

-- 12. workout_sessions — Individual completed workouts
CREATE TABLE workout_sessions (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_date            DATE            NOT NULL,
    workout_type            VARCHAR(50)     NULL,
    split_type              VARCHAR(30)     NULL,
    duration_minutes        INT             NULL,
    exercises_completed     INT             NULL,
    xp_earned               INT             DEFAULT 0,
    cycle_phase             VARCHAR(20)     NULL,
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       DEFAULT NOW()
);

-- 13. analysis_scans — Body scan records
CREATE TABLE analysis_scans (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scan_date       TIMESTAMP       DEFAULT NOW(),
    image_url       VARCHAR(500)    NOT NULL,
    thumbnail_url   VARCHAR(500)    NOT NULL,
    height_at_scan  DECIMAL(5,2)    NULL,
    weight_at_scan  DECIMAL(5,2)    NULL,
    bmi_at_scan     DECIMAL(4,2)    NULL,
    goal_at_scan    VARCHAR(20)     NULL,
    gender_at_scan  VARCHAR(20)     NULL,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- 14. analysis_results — Detailed metrics per scan
CREATE TABLE analysis_results (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id             UUID            NOT NULL UNIQUE REFERENCES analysis_scans(id) ON DELETE CASCADE,
    fitness_index       VARCHAR(10)     NULL,
    overall_grade       VARCHAR(10)     NULL,
    visual_age          INT             NULL,
    symmetry_score      INT             NULL,
    body_comp_score     INT             NULL,
    body_comp_category  VARCHAR(30)     NULL,
    body_type           VARCHAR(30)     NULL,
    lean_mass_estimate  VARCHAR(30)     NULL,
    muscle_tone_score   INT             NULL,
    muscle_upper_body   VARCHAR(30)     NULL,
    muscle_core         VARCHAR(30)     NULL,
    muscle_lower_body   VARCHAR(30)     NULL,
    posture_score       INT             NULL,
    posture_shoulder    VARCHAR(30)     NULL,
    posture_spine       VARCHAR(30)     NULL,
    posture_hip         VARCHAR(30)     NULL,
    zone_shoulders      VARCHAR(30)     NULL,
    zone_chest          VARCHAR(30)     NULL,
    zone_core           VARCHAR(30)     NULL,
    zone_legs           VARCHAR(30)     NULL,
    bmi                 DECIMAL(4,2)    NULL,
    bmi_category        VARCHAR(30)     NULL,
    raw_landmarks       JSON            NULL,
    created_at          TIMESTAMP       DEFAULT NOW()
);

-- 15. weekly_plans — Saved workout and meal plans
CREATE TABLE weekly_plans (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type       VARCHAR(20)     NOT NULL,
    plan_name       VARCHAR(100)    NULL,
    split_type      VARCHAR(30)     NULL,
    days_per_week   INT             NULL,
    equipment       VARCHAR(20)     NULL,
    intensity       VARCHAR(20)     NULL,
    cycle_phase     VARCHAR(20)     NULL,
    plan_data       JSON            NOT NULL,
    is_active       BOOLEAN         DEFAULT true,
    created_at      TIMESTAMP       DEFAULT NOW(),
    updated_at      TIMESTAMP       DEFAULT NOW()
);

-- 16. food_log — Daily food/nutrition tracking
CREATE TABLE food_log (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_id         UUID            NULL REFERENCES foods(id),
    log_date        DATE            NOT NULL,
    meal_type       VARCHAR(20)     NULL,
    food_name       VARCHAR(200)    NOT NULL,
    calories        INT             NULL,
    protein         DECIMAL(6,2)    NULL,
    carbs           DECIMAL(6,2)    NULL,
    fats            DECIMAL(6,2)    NULL,
    portion         VARCHAR(50)     NULL,
    quantity        DECIMAL(4,2)    DEFAULT 1,
    is_scanned      BOOLEAN         DEFAULT false,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- 17. coach_conversations — AI coach chat history
CREATE TABLE coach_conversations (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      UUID            NULL,
    role            VARCHAR(10)     NOT NULL,
    message         TEXT            NOT NULL,
    intent          VARCHAR(50)     NULL,
    persona         VARCHAR(20)     NULL,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- 18. weekly_challenges — User's active weekly challenges
CREATE TABLE weekly_challenges (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id        VARCHAR(50)     NOT NULL REFERENCES challenges(id),
    week_start          DATE            NOT NULL,
    current_progress    INT             DEFAULT 0,
    target              INT             NOT NULL,
    is_completed        BOOLEAN         DEFAULT false,
    completed_at        TIMESTAMP       NULL,
    xp_awarded          INT             DEFAULT 0,
    created_at          TIMESTAMP       DEFAULT NOW()
);

-- 19. food_recognition_mappings — ML label to food mapping
CREATE TABLE food_recognition_mappings (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    ml_label                VARCHAR(100)    NOT NULL UNIQUE,
    food_id                 UUID            NOT NULL REFERENCES foods(id),
    confidence_threshold    DECIMAL(3,2)    DEFAULT 0.50,
    created_at              TIMESTAMP       DEFAULT NOW()
);

-- ============================================================================
-- PART 4: SESSION / AUTH TABLES
-- ============================================================================

-- 20. user_sessions — Active login sessions (JWT)
CREATE TABLE user_sessions (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash   VARCHAR(255)    NOT NULL,
    refresh_token_hash  VARCHAR(255)    NOT NULL,
    device_info         VARCHAR(255)    NULL,
    ip_address          VARCHAR(45)     NULL,
    is_revoked          BOOLEAN         DEFAULT false,
    access_expires_at   TIMESTAMP       NOT NULL,
    refresh_expires_at  TIMESTAMP       NOT NULL,
    created_at          TIMESTAMP       DEFAULT NOW()
);

-- 21. email_verification_tokens — Email verify + password reset tokens
CREATE TABLE email_verification_tokens (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255)    NOT NULL UNIQUE,
    token_type      VARCHAR(30)     NOT NULL,
    expires_at      TIMESTAMP       NOT NULL,
    used_at         TIMESTAMP       NULL,
    created_at      TIMESTAMP       DEFAULT NOW()
);

-- ============================================================================
-- PART 5: INDEXES (13 indexes)
-- ============================================================================
-- Note: UNIQUE constraints on users.email, foods.name, food_recognition_mappings.ml_label,
-- and email_verification_tokens.token_hash already create implicit unique indexes in PostgreSQL.

-- Authentication & user lookups
CREATE INDEX idx_users_email_verified ON users(email_verified) WHERE email_verified = false;

-- Session management
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh ON user_sessions(refresh_token_hash) WHERE is_revoked = false;
CREATE INDEX idx_user_sessions_access ON user_sessions(access_token_hash) WHERE is_revoked = false;

-- Email verification tokens
CREATE INDEX idx_email_tokens_user_type ON email_verification_tokens(user_id, token_type);
CREATE INDEX idx_email_tokens_cleanup ON email_verification_tokens(expires_at) WHERE used_at IS NULL;

-- Scan history
CREATE INDEX idx_analysis_scans_user_date ON analysis_scans(user_id, scan_date DESC);

-- Workout history
CREATE INDEX idx_workout_sessions_user_date ON workout_sessions(user_id, workout_date DESC);

-- Food search
CREATE INDEX idx_foods_category ON foods(category);

-- Food log by date
CREATE INDEX idx_food_log_user_date ON food_log(user_id, log_date DESC);

-- Coach conversations
CREATE INDEX idx_coach_conversations_user ON coach_conversations(user_id, created_at DESC);

-- Achievements
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);

-- Challenges
CREATE INDEX idx_weekly_challenges_user_week ON weekly_challenges(user_id, week_start);

-- ============================================================================
-- PART 6: TRIGGER — auto-update updated_at columns
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_gamification_updated_at
    BEFORE UPDATE ON user_gamification
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_weekly_plans_updated_at
    BEFORE UPDATE ON weekly_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 7: SEED DATA (7 inserts — all from frontend source of truth)
-- ============================================================================

-- ----- 7.1  Foods (45 items from LOCAL_FOOD_DATABASE, script.js:88-132) -----
INSERT INTO foods (name, calories, protein, carbs, fats, portion, icon, category) VALUES
('Chicken Breast',    165, 31,  0, 4,  '100g serving',       '🍗', 'protein'),
('Salmon',            208, 20,  0, 13, '100g serving',       '🐟', 'protein'),
('Brown Rice',        112,  2, 24, 1,  '100g serving',       '🍚', 'carbs'),
('White Rice',        130,  3, 28, 0,  '100g serving',       '🍚', 'carbs'),
('Eggs',              155, 13,  1, 11, '100g (2 eggs)',      '🥚', 'protein'),
('Scrambled Eggs',    149, 10,  2, 11, '100g serving',       '🥚', 'protein'),
('Boiled Eggs',       155, 13,  1, 11, '100g (2 eggs)',      '🥚', 'protein'),
('Oatmeal',            68,  2, 12, 1,  '100g serving',       '🥣', 'carbs'),
('Greek Yogurt',       97,  9,  4, 5,  '100g serving',       '🥛', 'protein'),
('Banana',             89,  1, 23, 0,  '1 medium',           '🍌', 'fruit'),
('Apple',              52,  0, 14, 0,  '1 medium',           '🍎', 'fruit'),
('Broccoli',           34,  3,  7, 0,  '100g serving',       '🥦', 'vegetables'),
('Sweet Potato',       86,  2, 20, 0,  '100g serving',       '🍠', 'carbs'),
('Potato',             77,  2, 17, 0,  '100g serving',       '🥔', 'carbs'),
('Beef Steak',        271, 26,  0, 18, '100g serving',       '🥩', 'protein'),
('Ground Beef',       250, 26,  0, 15, '100g serving',       '🥩', 'protein'),
('Turkey Breast',     135, 30,  0, 1,  '100g serving',       '🍗', 'protein'),
('Tuna',              132, 28,  0, 1,  '100g serving',       '🐟', 'protein'),
('Shrimp',             85, 20,  0, 0,  '100g serving',       '🦐', 'protein'),
('Pasta',             131,  5, 25, 1,  '100g serving',       '🍝', 'carbs'),
('Bread',             265,  9, 49, 3,  '100g (2-3 slices)',  '🍞', 'carbs'),
('Whole Wheat Bread', 247, 13, 41, 3,  '100g serving',       '🍞', 'carbs'),
('Avocado',           160,  2,  9, 15, '100g serving',       '🥑', 'fats'),
('Almonds',           579, 21, 22, 50, '100g serving',       '🥜', 'fats'),
('Peanut Butter',     588, 25, 20, 50, '100g serving',       '🥜', 'fats'),
('Milk',               42,  3,  5, 1,  '100ml',              '🥛', 'protein'),
('Cheese',            402, 25,  1, 33, '100g serving',       '🧀', 'fats'),
('Cottage Cheese',     98, 11,  3, 4,  '100g serving',       '🧀', 'protein'),
('Pizza',             266, 11, 33, 10, '1 slice (100g)',     '🍕', 'mixed'),
('Burger',            295, 17, 24, 14, '1 patty with bun',   '🍔', 'mixed'),
('Salad',              20,  2,  3, 0,  '100g serving',       '🥗', 'vegetables'),
('Orange',             47,  1, 12, 0,  '1 medium',           '🍊', 'fruit'),
('Grapes',             69,  1, 18, 0,  '100g serving',       '🍇', 'fruit'),
('Strawberries',       32,  1,  8, 0,  '100g serving',       '🍓', 'fruit'),
('Spinach',            23,  3,  4, 0,  '100g serving',       '🥬', 'vegetables'),
('Carrots',            41,  1, 10, 0,  '100g serving',       '🥕', 'vegetables'),
('Corn',               86,  3, 19, 1,  '100g serving',       '🌽', 'carbs'),
('Beans',             127,  9, 23, 0,  '100g serving',       '🫘', 'protein'),
('Lentils',           116,  9, 20, 0,  '100g serving',       '🫘', 'protein'),
('Tofu',               76,  8,  2, 5,  '100g serving',       '🧈', 'protein'),
('Quinoa',            120,  4, 21, 2,  '100g serving',       '🌾', 'carbs'),
('Coffee',              2,  0,  0, 0,  '1 cup (240ml)',      '☕', 'beverages'),
('Orange Juice',       45,  1, 10, 0,  '100ml',              '🍊', 'beverages'),
('Protein Shake',     120, 25,  3, 1,  '1 scoop (30g)',      '🥤', 'supplements'),
('Whey Protein',      120, 24,  3, 2,  '1 scoop (30g)',      '🥤', 'supplements');

-- ----- 7.2  Exercises — gym (31 exercises, script.js:3754-3798) -----
INSERT INTO exercises (name, muscle_group, equipment_type, default_sets, default_reps, target_muscles) VALUES
-- chest (gym)
('Bench Press',              'chest',     'gym', 4, '8-10',  '["Chest", "Triceps"]'),
('Incline Dumbbell Press',   'chest',     'gym', 3, '10-12', '["Upper Chest", "Shoulders"]'),
('Cable Flyes',              'chest',     'gym', 3, '12-15', '["Chest"]'),
('Push-Ups',                 'chest',     'gym', 3, '15-20', '["Chest", "Core"]'),
('Dips',                     'chest',     'gym', 3, '10-12', '["Chest", "Triceps"]'),
-- back (gym)
('Pull-Ups',                 'back',      'gym', 4, '8-10',  '["Lats", "Biceps"]'),
('Barbell Rows',             'back',      'gym', 4, '8-10',  '["Back", "Biceps"]'),
('Lat Pulldown',             'back',      'gym', 3, '10-12', '["Lats"]'),
('Seated Cable Rows',        'back',      'gym', 3, '12-15', '["Mid Back"]'),
('Face Pulls',               'back',      'gym', 3, '15-20', '["Rear Delts", "Traps"]'),
-- shoulders (gym)
('Overhead Press',           'shoulders', 'gym', 4, '8-10',  '["Shoulders", "Triceps"]'),
('Lateral Raises',           'shoulders', 'gym', 3, '12-15', '["Side Delts"]'),
('Front Raises',             'shoulders', 'gym', 3, '12-15', '["Front Delts"]'),
('Reverse Flyes',            'shoulders', 'gym', 3, '15',    '["Rear Delts"]'),
('Arnold Press',             'shoulders', 'gym', 3, '10-12', '["Shoulders"]'),
-- legs (gym)
('Squats',                   'legs',      'gym', 4, '8-10',  '["Quads", "Glutes"]'),
('Romanian Deadlifts',       'legs',      'gym', 4, '10-12', '["Hamstrings", "Glutes"]'),
('Leg Press',                'legs',      'gym', 3, '12-15', '["Quads"]'),
('Leg Curls',                'legs',      'gym', 3, '12-15', '["Hamstrings"]'),
('Calf Raises',              'legs',      'gym', 4, '15-20', '["Calves"]'),
('Lunges',                   'legs',      'gym', 3, '10 each', '["Quads", "Glutes"]'),
-- arms (gym)
('Barbell Curls',            'arms',      'gym', 3, '10-12', '["Biceps"]'),
('Tricep Pushdowns',         'arms',      'gym', 3, '12-15', '["Triceps"]'),
('Hammer Curls',             'arms',      'gym', 3, '12',    '["Biceps", "Forearms"]'),
('Skull Crushers',           'arms',      'gym', 3, '10-12', '["Triceps"]'),
('Concentration Curls',      'arms',      'gym', 2, '12-15', '["Biceps"]'),
-- core (gym)
('Plank',                    'core',      'gym', 3, '60s',   '["Core"]'),
('Hanging Leg Raises',       'core',      'gym', 3, '12-15', '["Abs"]'),
('Cable Crunches',           'core',      'gym', 3, '15-20', '["Abs"]'),
('Russian Twists',           'core',      'gym', 3, '20',    '["Obliques"]'),
('Dead Bug',                 'core',      'gym', 3, '10 each', '["Core"]');

-- ----- 7.3  Exercises — home (32 exercises, script.js:3801-3846) -----
INSERT INTO exercises (name, muscle_group, equipment_type, default_sets, default_reps, target_muscles) VALUES
-- chest (home)
('Push-Ups',                      'chest',     'home', 4, '15-20',  '["Chest", "Triceps"]'),
('Diamond Push-Ups',              'chest',     'home', 3, '10-15',  '["Chest", "Triceps"]'),
('Wide Push-Ups',                 'chest',     'home', 3, '12-15',  '["Chest"]'),
('Decline Push-Ups',              'chest',     'home', 3, '10-15',  '["Upper Chest", "Shoulders"]'),
('Pike Push-Ups',                 'chest',     'home', 3, '8-12',   '["Chest", "Shoulders"]'),
-- back (home)
('Supermans',                     'back',      'home', 3, '15-20',  '["Lower Back", "Glutes"]'),
('Reverse Snow Angels',           'back',      'home', 3, '12-15',  '["Back", "Rear Delts"]'),
('Prone Y Raises',                'back',      'home', 3, '12-15',  '["Upper Back", "Traps"]'),
('Bird Dogs',                     'back',      'home', 3, '10 each','["Back", "Core"]'),
('Towel Rows',                    'back',      'home', 3, '10-12',  '["Lats", "Biceps"]'),
-- shoulders (home)
('Pike Push-Ups',                 'shoulders', 'home', 3, '8-12',   '["Shoulders", "Triceps"]'),
('Arm Circles',                   'shoulders', 'home', 3, '20 each','["Shoulders"]'),
('Wall Handstand Hold',           'shoulders', 'home', 3, '20-30s', '["Shoulders", "Core"]'),
('Prone I-Y-T Raises',            'shoulders', 'home', 3, '10 each','["Rear Delts", "Traps"]'),
('Lateral Plank Walk',            'shoulders', 'home', 3, '8 each', '["Shoulders", "Core"]'),
-- legs (home)
('Bodyweight Squats',             'legs',      'home', 4, '15-20',  '["Quads", "Glutes"]'),
('Lunges',                        'legs',      'home', 3, '12 each','["Quads", "Glutes"]'),
('Glute Bridges',                 'legs',      'home', 3, '15-20',  '["Glutes", "Hamstrings"]'),
('Bulgarian Split Squats',        'legs',      'home', 3, '10 each','["Quads", "Glutes"]'),
('Wall Sits',                     'legs',      'home', 3, '45-60s', '["Quads"]'),
('Single-Leg Calf Raises',        'legs',      'home', 3, '15 each','["Calves"]'),
-- arms (home)
('Diamond Push-Ups',              'arms',      'home', 3, '10-15',  '["Triceps", "Chest"]'),
('Tricep Dips (Chair)',            'arms',      'home', 3, '12-15',  '["Triceps"]'),
('Chin-Up Hold (Door Frame)',      'arms',      'home', 3, '15-20s', '["Biceps"]'),
('Isometric Bicep Curl (Towel)',   'arms',      'home', 3, '20-30s', '["Biceps"]'),
('Plank Shoulder Taps',           'arms',      'home', 3, '10 each','["Arms", "Core"]'),
-- core (home)
('Plank',                         'core',      'home', 3, '60s',    '["Core"]'),
('Crunches',                      'core',      'home', 3, '20',     '["Abs"]'),
('Bicycle Crunches',              'core',      'home', 3, '15 each','["Obliques", "Abs"]'),
('Mountain Climbers',             'core',      'home', 3, '20 each','["Core", "Cardio"]'),
('Dead Bug',                      'core',      'home', 3, '10 each','["Core"]'),
('Leg Raises',                    'core',      'home', 3, '12-15',  '["Lower Abs"]');

-- ----- 7.4  Achievements (14 from ACHIEVEMENTS, script.js:7865-7879) -----
INSERT INTO achievements (id, title, icon, description, category, xp_reward, sort_order) VALUES
('first-scan',    'First Scan',          '📸', 'Complete 1 analysis',      'scan',      25, 1),
('scan-veteran',  'Scan Veteran',        '🔬', '5 analyses',              'scan',      25, 2),
('first-workout', 'First Rep',           '💪', 'Complete 1 workout',      'workout',   25, 3),
('workout-5',     'Gym Rat',             '🏋️', '5 workouts',              'workout',   25, 4),
('workout-10',    'Iron Will',           '⚡', '10 workouts',             'workout',   25, 5),
('workout-25',    'Legend',              '👑', '25 workouts',             'workout',   25, 6),
('meal-plan',     'Meal Prepper',        '🍽️', 'Generate meal plan',      'nutrition', 25, 7),
('food-scan',     'Food Detective',      '🔍', 'Scan a food',             'nutrition', 25, 8),
('all-personas',  'Social Butterfly',    '🦋', 'Try all 4 personas',      'social',    25, 9),
('streak-3',      'On Fire',             '🔥', '3-day streak',            'streak',    25, 10),
('streak-7',      'Unstoppable',         '🚀', '7-day streak',            'streak',    25, 11),
('streak-30',     'Dedicated',           '🏆', '30-day streak',           'streak',    25, 12),
('first-compare', 'Time Traveler',       '⏳', 'Compare 2 scans',         'scan',      25, 13),
('scan-5',        'Dedicated Tracker',   '📊', '5 analysis scans saved',  'scan',      25, 14);

-- ----- 7.5  Challenges (8 from CHALLENGE_POOL, script.js:7885-7894) -----
INSERT INTO challenges (id, name, icon, target, metric_key, xp_reward, category) VALUES
('workouts-3',  'Complete 3 workouts',      '🏋️', 3, 'total_workouts',    25, 'workout'),
('workouts-5',  'Complete 5 workouts',      '💪', 5, 'total_workouts',    25, 'workout'),
('analyses-2',  'Run 2 analyses',           '📊', 2, 'total_analyses',    25, 'scan'),
('coach-3',     'Ask coach 3 questions',    '💬', 3, 'coach_questions',   25, 'coach'),
('coach-5',     'Ask coach 5 questions',    '🗣️', 5, 'coach_questions',   25, 'coach'),
('nutrition',   'Check nutrition screen',   '🥗', 1, 'nutrition_views',   25, 'nutrition'),
('personas-2',  'Try 2 coach personas',     '🎭', 2, 'personas_used',     25, 'social'),
('meal-plan',   'Generate a meal plan',     '📋', 1, 'meal_plans_generated', 25, 'nutrition');

-- ----- 7.6  Levels (20 from LEVEL_THRESHOLDS + RANK_NAMES, script.js:7882-7883) -----
INSERT INTO levels (level, xp_required, rank_name) VALUES
( 1,     0, 'Beginner'),
( 2,   100, 'Novice'),
( 3,   250, 'Rookie'),
( 4,   450, 'Apprentice'),
( 5,   700, 'Dedicated'),
( 6,  1000, 'Consistent'),
( 7,  1400, 'Skilled'),
( 8,  1900, 'Advanced'),
( 9,  2500, 'Expert'),
(10,  3200, 'Elite'),
(11,  4000, 'Champion'),
(12,  5000, 'Master'),
(13,  6200, 'Grandmaster'),
(14,  7600, 'Prodigy'),
(15,  9200, 'Virtuoso'),
(16, 11000, 'Titan'),
(17, 13000, 'Mythic'),
(18, 15500, 'Legendary'),
(19, 18500, 'Immortal'),
(20, 22000, 'Transcendent');

-- ----- 7.7  Workout Splits (4 from splitTemplates, script.js:3849-3881) -----
INSERT INTO workout_splits (id, name, description, days_pattern, day_configs, recommended_for) VALUES
(
    'push-pull-legs',
    'Push Pull Legs',
    'Classic 5-day split targeting push, pull, and leg movements',
    '["Push", "Pull", "Legs", "Push", "Pull", "Rest", "Rest"]',
    '{"Push": {"focus": "Chest, Shoulders, Triceps", "muscles": ["chest", "shoulders", "arms"]}, "Pull": {"focus": "Back, Biceps, Rear Delts", "muscles": ["back", "arms"]}, "Legs": {"focus": "Quads, Hamstrings, Glutes, Calves", "muscles": ["legs", "core"]}}',
    'Intermediate to advanced lifters'
),
(
    'upper-lower',
    'Upper Lower',
    'Balanced 4-day split alternating upper and lower body',
    '["Upper", "Lower", "Rest", "Upper", "Lower", "Rest", "Rest"]',
    '{"Upper": {"focus": "Chest, Back, Shoulders, Arms", "muscles": ["chest", "back", "shoulders", "arms"]}, "Lower": {"focus": "Quads, Hamstrings, Glutes, Core", "muscles": ["legs", "core"]}}',
    'Beginners to intermediate lifters'
),
(
    'full-body',
    'Full Body',
    'Hit all muscle groups each session, 3 days per week',
    '["Full Body", "Rest", "Full Body", "Rest", "Full Body", "Rest", "Rest"]',
    '{"Full Body": {"focus": "All Major Muscle Groups", "muscles": ["chest", "back", "legs", "shoulders", "core"]}}',
    'Beginners or those with limited time'
),
(
    'bro-split',
    'Bro Split',
    'Dedicated day per muscle group, 5 days per week',
    '["Chest", "Back", "Shoulders", "Legs", "Arms", "Rest", "Rest"]',
    '{"Chest": {"focus": "Chest & Triceps", "muscles": ["chest", "arms"]}, "Back": {"focus": "Back & Biceps", "muscles": ["back", "arms"]}, "Shoulders": {"focus": "Shoulders & Traps", "muscles": ["shoulders"]}, "Legs": {"focus": "Quads, Hamstrings, Glutes", "muscles": ["legs"]}, "Arms": {"focus": "Biceps, Triceps, Forearms", "muscles": ["arms"]}}',
    'Intermediate to advanced, bodybuilding focus'
);

-- ============================================================================
-- Migration complete.
-- 21 tables, 13 indexes, 4 triggers, 7 seed inserts
-- All seed data sourced from frontend script.js (source of truth)
-- ============================================================================
