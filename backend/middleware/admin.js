const { appError, ErrorCodes } = require('../utils/errors');

function admin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(appError(ErrorCodes.FORBIDDEN, 'Admin access required'));
  }
  next();
}

module.exports = admin;
