const { z } = require('zod');

// Allowed TLDs — generic + major country codes (no .uk, .acom, etc.)
const ALLOWED_TLDS = /\.(com|net|org|edu|gov|io|co|info|biz|me|app|dev|pt|us|ca|au|de|fr|es|it|br|jp|nl|be|ch|mx|ar|cl|pl|in|cn|za|ng|ao|mz|cv|gq)$/i;

const emailSchema = z.string()
  .email('Invalid email address')
  .max(255)
  .refine(
    e => /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]{2,}(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/.test(e),
    'Please enter a valid email address (e.g. name@example.com)'
  )
  .refine(
    e => ALLOWED_TLDS.test(e),
    'Email domain not accepted. Please use a common provider (e.g. Gmail, Outlook) or your school email.'
  );

// Password: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number
const passwordSchema = z.string().min(8).max(128)
  .refine(p => /[A-Z]/.test(p), 'Password must contain at least one uppercase letter')
  .refine(p => /[a-z]/.test(p), 'Password must contain at least one lowercase letter')
  .refine(p => /[0-9]/.test(p), 'Password must contain at least one number');

// ── Auth ──
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().min(1).max(100),
  gender: z.enum(['male', 'female', 'other', 'non-binary', 'prefer-not-to-say']).optional(),
  height: z.number().min(100).max(250).optional(),
  weight: z.number().min(30).max(300).optional(),
  age_range: z.string().max(10).optional(),
  activity_level: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active', 'athlete']).optional(),
  fitness_goal: z.enum(['lose_weight', 'build_muscle', 'maintain', 'improve_posture', 'general']).optional(),
  experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: emailSchema,
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Users ──
const updateProfileSchema = z.object({
  email: emailSchema.optional(),
  display_name: z.string().max(100).optional(),
  gender: z.enum(['male', 'female', 'other', 'non-binary', 'prefer-not-to-say']).optional(),
  height: z.number().min(100).max(250).optional(),
  weight: z.number().min(30).max(300).optional(),
  age_range: z.string().max(10).optional(),
  activity_level: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active', 'athlete']).optional(),
  fitness_goal: z.enum(['lose_weight', 'build_muscle', 'maintain', 'improve_posture', 'general']).optional(),
  experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  avatar_url: z.string().max(200000).nullable().optional(),
});

const updatePreferencesSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  coach_persona: z.enum(['encouraging', 'drill_sergeant', 'scientific', 'casual']).optional(),
});

// ── Analysis ──
const createScanSchema = z.object({
  image_url: z.string().optional().nullable(),
  thumbnail_url: z.string().optional().nullable(),
  height_at_scan: z.number().min(100).max(250).optional().nullable(),
  weight_at_scan: z.number().min(30).max(300).optional().nullable(),
  bmi_at_scan: z.number().positive().optional().nullable(),
  goal_at_scan: z.string().max(20).optional().nullable(),
  gender_at_scan: z.string().max(20).optional().nullable(),
  results: z.object({
    fitness_index: z.string().max(10).optional().nullable(),
    overall_grade: z.string().max(10).optional().nullable(),
    visual_age: z.number().int().optional().nullable(),
    symmetry_score: z.number().int().optional().nullable(),
    body_comp_score: z.number().int().optional().nullable(),
    body_comp_category: z.string().max(30).optional().nullable(),
    body_type: z.string().max(30).optional().nullable(),
    lean_mass_estimate: z.string().max(30).optional().nullable(),
    muscle_tone_score: z.number().int().optional().nullable(),
    muscle_upper_body: z.string().max(30).optional().nullable(),
    muscle_core: z.string().max(30).optional().nullable(),
    muscle_lower_body: z.string().max(30).optional().nullable(),
    posture_score: z.number().int().optional().nullable(),
    posture_shoulder: z.string().max(30).optional().nullable(),
    posture_spine: z.string().max(30).optional().nullable(),
    posture_hip: z.string().max(30).optional().nullable(),
    zone_shoulders: z.string().max(30).optional().nullable(),
    zone_chest: z.string().max(30).optional().nullable(),
    zone_core: z.string().max(30).optional().nullable(),
    zone_legs: z.string().max(30).optional().nullable(),
    bmi: z.number().optional().nullable(),
    bmi_category: z.string().max(30).optional().nullable(),
    raw_landmarks: z.any().optional().nullable(),
  }),
});

const compareScanSchema = z.object({
  scan_id_1: z.string().uuid(),
  scan_id_2: z.string().uuid(),
});

// ── Workouts ──
const generateWorkoutSchema = z.object({
  split_type: z.string().min(1),
  equipment: z.enum(['gym', 'home']).default('gym'),
  days_per_week: z.number().int().min(1).max(7).optional(),
  intensity: z.enum(['light', 'moderate', 'intense']).optional(),
  fitness_goal: z.string().optional(),
  cycle_phase: z.string().optional().nullable(),
});

const saveWorkoutPlanSchema = z.object({
  plan_name: z.string().max(100).optional(),
  split_type: z.string().max(30).optional(),
  days_per_week: z.number().int().min(1).max(7).optional(),
  equipment: z.string().max(20).optional(),
  intensity: z.string().max(20).optional(),
  cycle_phase: z.string().max(20).optional().nullable(),
  plan_data: z.any(),
});

const updateWorkoutPlanSchema = z.object({
  plan_name: z.string().max(100).optional(),
  is_active: z.boolean().optional(),
  plan_data: z.any().optional(),
});

const logWorkoutSessionSchema = z.object({
  workout_date: z.string().min(1),
  workout_type: z.string().max(50).optional(),
  split_type: z.string().max(30).optional(),
  duration_minutes: z.number().int().positive().optional(),
  exercises_completed: z.number().int().min(0).optional(),
  cycle_phase: z.string().max(20).optional().nullable(),
  notes: z.string().max(500).optional(),
});

// ── Nutrition ──
const recognizeFoodSchema = z.object({
  ml_label: z.string().min(1),
});

const generateMealPlanSchema = z.object({
  calorie_target: z.number().int().positive().max(5000).optional(),
  protein_target: z.number().positive().max(400).optional(),
  meals_per_day: z.number().int().min(1).max(6).default(3),
  fitness_goal: z.string().optional(),
  preferences: z.array(z.string()).optional(),
});

const saveMealPlanSchema = z.object({
  plan_name: z.string().max(100).optional(),
  plan_data: z.any(),
});

const logFoodSchema = z.object({
  food_id: z.string().uuid().optional().nullable(),
  log_date: z.string().min(1),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  food_name: z.string().max(200),
  calories: z.number().int().min(0).max(3000).optional(),
  protein: z.number().min(0).max(300).optional(),
  carbs: z.number().min(0).max(300).optional(),
  fats: z.number().min(0).max(200).optional(),
  portion: z.string().max(50).optional(),
  quantity: z.number().positive().default(1),
  is_scanned: z.boolean().default(false),
});

// ── Coach ──
const coachMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  persona: z.enum(['encouraging', 'drill_sergeant', 'scientific', 'casual']).default('encouraging'),
});

// ── Admin ──
const adminResetPasswordSchema = z.object({
  password: passwordSchema,
});

const adminUpdateUserSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  email_verified: z.boolean().optional(),
  display_name: z.string().max(100).optional(),
  email: emailSchema.optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

const stringIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

// ── Admin Content CRUD ──
const createFoodSchema = z.object({
  name: z.string().min(1).max(100),
  calories: z.number().int().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fats: z.number().min(0),
  fiber: z.number().min(0).optional().nullable(),
  sugar: z.number().min(0).optional().nullable(),
  sodium: z.number().min(0).optional().nullable(),
  portion: z.string().max(50).optional().nullable(),
  portion_grams: z.number().int().positive().optional().nullable(),
  icon: z.string().max(10).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  tags: z.string().max(255).optional().nullable(),
  is_active: z.boolean().default(true),
});

const createExerciseSchema = z.object({
  name: z.string().min(1).max(100),
  muscle_group: z.string().min(1).max(30),
  equipment_type: z.enum(['gym', 'home']),
  default_sets: z.number().int().min(1).max(20),
  default_reps: z.string().min(1).max(20),
  target_muscles: z.any().optional().nullable(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  video_url: z.string().max(500).optional().nullable(),
  is_active: z.boolean().default(true),
});

const createAchievementSchema = z.object({
  id: z.string().min(1).max(50),
  title: z.string().min(1).max(100),
  icon: z.string().max(10).optional().nullable(),
  description: z.string().min(1).max(255),
  category: z.string().max(30).optional().nullable(),
  xp_reward: z.number().int().min(0).max(10000),
  sort_order: z.number().int().min(0).max(1000),
  is_active: z.boolean().default(true),
});

const createChallengeSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional().nullable(),
  target: z.number().int().positive(),
  metric_key: z.string().min(1).max(50),
  xp_reward: z.number().int().min(0).max(10000),
  category: z.string().max(30).optional().nullable(),
  is_active: z.boolean().default(true),
});

const createSplitSchema = z.object({
  id: z.string().min(1).max(30),
  name: z.string().min(1).max(50),
  description: z.string().max(255).optional().nullable(),
  days_pattern: z.any(),
  day_configs: z.any(),
  recommended_for: z.string().max(100).optional().nullable(),
  is_active: z.boolean().default(true),
});

// ── Wearable ──
const wearableSessionSchema = z.object({
  steps:        z.number().int().min(0).max(100000).default(0),
  hr_avg:       z.number().int().min(40).max(220).optional().nullable(),
  hr_readings:  z.array(z.number().min(0).max(300)).max(1440).optional().nullable(),
  calories:     z.number().min(0).max(10000).optional().nullable(),
  active_secs:  z.number().int().min(0).max(86400).default(0),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'session_date must be YYYY-MM-DD').optional(),
});

// ── Pagination query ──
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  passwordSchema,
  adminResetPasswordSchema,
  wearableSessionSchema,
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  refreshSchema,
  updateProfileSchema,
  updatePreferencesSchema,
  createScanSchema,
  compareScanSchema,
  generateWorkoutSchema,
  saveWorkoutPlanSchema,
  updateWorkoutPlanSchema,
  logWorkoutSessionSchema,
  recognizeFoodSchema,
  generateMealPlanSchema,
  saveMealPlanSchema,
  logFoodSchema,
  coachMessageSchema,
  adminUpdateUserSchema,
  paginationSchema,
  uuidParamSchema,
  stringIdParamSchema,
  createFoodSchema,
  createExerciseSchema,
  createAchievementSchema,
  createChallengeSchema,
  createSplitSchema,
};
