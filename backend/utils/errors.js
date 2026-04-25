class AppError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

const ErrorCodes = {
  VALIDATION_ERROR:    { code: 'VALIDATION_ERROR',    status: 400 },
  UNAUTHORIZED:        { code: 'UNAUTHORIZED',        status: 401 },
  TOKEN_EXPIRED:       { code: 'TOKEN_EXPIRED',       status: 401 },
  TOKEN_INVALID:       { code: 'TOKEN_INVALID',       status: 401 },
  FORBIDDEN:           { code: 'FORBIDDEN',           status: 403 },
  EMAIL_NOT_VERIFIED:  { code: 'EMAIL_NOT_VERIFIED',  status: 403 },
  NOT_FOUND:           { code: 'NOT_FOUND',           status: 404 },
  EMAIL_EXISTS:        { code: 'EMAIL_EXISTS',        status: 409 },
  ACCOUNT_LOCKED:      { code: 'ACCOUNT_LOCKED',      status: 423 },
  RATE_LIMITED:        { code: 'RATE_LIMITED',         status: 429 },
  SERVER_ERROR:        { code: 'SERVER_ERROR',         status: 500 },
};

function appError(errorCode, message) {
  return new AppError(errorCode.code, message || errorCode.code, errorCode.status);
}

module.exports = { AppError, ErrorCodes, appError };
