const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../database/db');
const { appError, ErrorCodes } = require('../utils/errors');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, hashToken, generateRandomToken, generateVerificationCode } = require('../utils/tokens');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const { authLimiter, resendLimiter } = require('../middleware/rateLimiter');
const { registerSchema, loginSchema, verifyEmailSchema, resendVerificationSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, refreshSchema } = require('../validators/schemas');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 30;

// POST /register
router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const { email, password, display_name, gender, height, weight, age_range, activity_level, fitness_goal, experience_level } = req.body;

    // Check existing
    const exists = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) throw appError(ErrorCodes.EMAIL_EXISTS, 'Email already registered');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Auto-verify only when neither Resend nor SMTP is configured
    const emailConfigured = !!(process.env.GMAIL_USER || process.env.RESEND_API_KEY || process.env.SMTP_HOST);
    const autoVerify = !emailConfigured;

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, display_name, gender, height, weight, age_range, activity_level, fitness_goal, experience_level, email_verified, email_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, email, display_name, role, created_at`,
      [email, passwordHash, display_name || null, gender || null, height || null, weight || null, age_range || null, activity_level || null, fitness_goal || null, experience_level || 'intermediate',
       autoVerify, autoVerify ? new Date() : null]
    );
    const user = userResult.rows[0];

    // Create preferences + gamification
    await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [user.id]);
    await client.query('INSERT INTO user_gamification (user_id) VALUES ($1)', [user.id]);

    if (!autoVerify) {
      // Email verification code (6-digit)
      const verificationCode = generateVerificationCode();
      const tokenHash = hashToken(verificationCode);
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, token_type, expires_at)
         VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '24 hours')`,
        [user.id, tokenHash]
      );
      await client.query('COMMIT');
      let emailSent = true;
      try {
        await sendVerificationEmail(email, verificationCode);
      } catch (emailErr) {
        emailSent = false;
        console.error('[register] Failed to send verification email:', emailErr.message);
      }
      res.status(201).json({
        message: emailSent
          ? 'Account created. Check your email for your verification code.'
          : 'Account created but we could not send the verification email. Use "Resend verification" to try again.',
        user,
        emailSent,
      });
    } else {
      await client.query('COMMIT');
      res.status(201).json({ message: 'Account created successfully.', user });
    }
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

// POST /verify-email
router.post('/verify-email', validate(verifyEmailSchema), async (req, res, next) => {
  try {
    const tokenHash = hashToken(req.body.token);

    // Atomic: mark used in one query — only one concurrent request can claim the token
    const result = await db.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE token_hash = $1 AND token_type = 'email_verification' AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    );

    if (result.rows.length === 0) throw appError(ErrorCodes.TOKEN_INVALID, 'Invalid or expired verification token');

    await db.query('UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1', [result.rows[0].user_id]);

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /resend-verification
router.post('/resend-verification', resendLimiter, validate(resendVerificationSchema), async (req, res, next) => {
  try {
    const user = (await db.query('SELECT id, email_verified FROM users WHERE email = $1', [req.body.email])).rows[0];

    if (user && !user.email_verified) {
      // Invalidate old tokens
      await db.query(
        `UPDATE email_verification_tokens SET used_at = NOW()
         WHERE user_id = $1 AND token_type = 'email_verification' AND used_at IS NULL`,
        [user.id]
      );

      const verificationCode = generateVerificationCode();
      const tokenHash = hashToken(verificationCode);
      await db.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, token_type, expires_at)
         VALUES ($1, $2, 'email_verification', NOW() + INTERVAL '24 hours')`,
        [user.id, tokenHash]
      );

      try {
        await sendVerificationEmail(req.body.email, verificationCode);
      } catch (emailErr) {
        console.error('[resend] Failed to send verification email:', emailErr.message);
      }
    }

    // Always 200 to prevent email enumeration
    res.json({ message: 'If that email exists and is unverified, a new link has been sent' });
  } catch (err) {
    next(err);
  }
});

// POST /login
router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const userResult = await db.query(
      `SELECT id, email, password_hash, email_verified, role, display_name, avatar_url,
              failed_login_attempts, locked_until
       FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) throw appError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password');
    const user = userResult.rows[0];

    // Check lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw appError(ErrorCodes.ACCOUNT_LOCKED, 'Account locked due to too many failed attempts');
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const lockUntil = attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000)
        : null;

      await db.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockUntil, user.id]
      );
      throw appError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password');
    }

    // Reset failed attempts
    await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1', [user.id]);

    // Check email verified
    if (!user.email_verified) throw appError(ErrorCodes.EMAIL_NOT_VERIFIED, 'Please verify your email before logging in');

    // Generate tokens
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Store session
    await db.query(
      `INSERT INTO user_sessions (user_id, access_token_hash, refresh_token_hash, device_info, ip_address, access_expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '15 minutes', NOW() + INTERVAL '7 days')`,
      [user.id, hashToken(accessToken), hashToken(refreshToken), req.headers['user-agent'] || null, req.ip]
    );

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// POST /logout
router.post('/logout', auth, async (req, res, next) => {
  try {
    const token = req.headers.authorization.slice(7);
    await db.query(
      'UPDATE user_sessions SET is_revoked = true WHERE access_token_hash = $1',
      [hashToken(token)]
    );
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /refresh
router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw appError(ErrorCodes.TOKEN_EXPIRED, 'Refresh token expired');
      throw appError(ErrorCodes.TOKEN_INVALID, 'Invalid refresh token');
    }

    const refreshHash = hashToken(refreshToken);
    const session = await db.query(
      `SELECT id, user_id FROM user_sessions
       WHERE refresh_token_hash = $1 AND is_revoked = false AND refresh_expires_at > NOW()`,
      [refreshHash]
    );

    if (session.rows.length === 0) throw appError(ErrorCodes.UNAUTHORIZED, 'Session not found or revoked');

    // Revoke old session
    await db.query('UPDATE user_sessions SET is_revoked = true WHERE id = $1', [session.rows[0].id]);

    // Generate new tokens
    const userId = session.rows[0].user_id;
    const user = (await db.query('SELECT id, email, role FROM users WHERE id = $1', [userId])).rows[0];
    const newPayload = { sub: user.id, email: user.email, role: user.role };
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    await db.query(
      `INSERT INTO user_sessions (user_id, access_token_hash, refresh_token_hash, device_info, ip_address, access_expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '15 minutes', NOW() + INTERVAL '7 days')`,
      [userId, hashToken(newAccessToken), hashToken(newRefreshToken), req.headers['user-agent'] || null, req.ip]
    );

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

// POST /forgot-password
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const user = (await db.query('SELECT id FROM users WHERE email = $1', [req.body.email])).rows[0];

    if (user) {
      // Invalidate old reset tokens
      await db.query(
        `UPDATE email_verification_tokens SET used_at = NOW()
         WHERE user_id = $1 AND token_type = 'password_reset' AND used_at IS NULL`,
        [user.id]
      );

      const rawToken = generateRandomToken();
      await db.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, token_type, expires_at)
         VALUES ($1, $2, 'password_reset', NOW() + INTERVAL '1 hour')`,
        [user.id, hashToken(rawToken)]
      );

      try {
        await sendPasswordResetEmail(req.body.email, rawToken);
      } catch (emailErr) {
        console.error('[forgot-password] Failed to send reset email:', emailErr.message);
      }
    }

    // Always 200
    res.json({ message: 'If that email exists, a password reset link has been sent' });
  } catch (err) {
    next(err);
  }
});

// POST /reset-password
router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const tokenHash = hashToken(req.body.token);

    // Atomic: mark used in one query — prevents race condition with concurrent requests
    const result = await db.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE token_hash = $1 AND token_type = 'password_reset' AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    );

    if (result.rows.length === 0) throw appError(ErrorCodes.TOKEN_INVALID, 'Invalid or expired reset token');

    const { user_id } = result.rows[0];
    const passwordHash = await bcrypt.hash(req.body.password, SALT_ROUNDS);

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user_id]);

    // Revoke all sessions
    await db.query('UPDATE user_sessions SET is_revoked = true WHERE user_id = $1', [user_id]);

    res.json({ message: 'Password reset successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

// POST /change-password
router.post('/change-password', auth, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const userResult = await db.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (userResult.rows.length === 0) throw appError(ErrorCodes.NOT_FOUND, 'User not found');

    const user = userResult.rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw appError(ErrorCodes.UNAUTHORIZED, 'Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

    // Revoke all existing sessions so other devices must re-authenticate
    await db.query('UPDATE user_sessions SET is_revoked = true WHERE user_id = $1', [req.user.id]);

    res.json({ message: 'Password changed successfully. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
