const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV === 'development';
// In development, use generous limits to avoid blocking during testing
const devMultiplier = isDev ? 10 : 1;

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many auth attempts, try again later' } },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Resend limit reached, try again in an hour' } },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Upload limit reached, try again in an hour' } },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many admin requests, try again later' } },
});

const coachLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Coach message limit reached, try again later' } },
});

module.exports = { generalLimiter, authLimiter, resendLimiter, uploadLimiter, adminLimiter, coachLimiter };
