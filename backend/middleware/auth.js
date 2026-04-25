const { verifyAccessToken, hashToken } = require('../utils/tokens');
const { appError, ErrorCodes } = require('../utils/errors');
const db = require('../database/db');

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw appError(ErrorCodes.UNAUTHORIZED, 'Missing or invalid authorization header');
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw appError(ErrorCodes.TOKEN_EXPIRED, 'Access token expired');
      }
      throw appError(ErrorCodes.TOKEN_INVALID, 'Invalid access token');
    }

    // Verify session not revoked
    const tokenHash = hashToken(token);
    const session = await db.query(
      `SELECT id FROM user_sessions
       WHERE access_token_hash = $1 AND is_revoked = false AND access_expires_at > NOW()`,
      [tokenHash]
    );

    if (session.rows.length === 0) {
      throw appError(ErrorCodes.UNAUTHORIZED, 'Session revoked or expired');
    }

    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = auth;
