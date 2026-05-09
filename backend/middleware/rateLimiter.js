const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,                    // ~133 req/min — enough for normal multi-device usage + sync burst
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,                      // 4 logins/min — prevents brute-force, won't block real use
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many auth attempts, try again later' } },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Resend limit reached, try again in an hour' } },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Upload limit reached, try again in an hour' } },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many admin requests, try again later' } },
});

const coachLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,                     // 2 messages/min — enough for a conversation
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Coach message limit reached, try again later' } },
});

module.exports = { generalLimiter, authLimiter, resendLimiter, uploadLimiter, adminLimiter, coachLimiter };
