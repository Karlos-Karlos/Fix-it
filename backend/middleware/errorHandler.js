const { AppError } = require('../utils/errors');

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'File too large (max 10 MB)' },
    });
  }

  console.error(`[${req.method} ${req.path}] user=${req.user?.id ?? 'anon'} error:`, err);
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Internal server error' },
  });
}

module.exports = errorHandler;
