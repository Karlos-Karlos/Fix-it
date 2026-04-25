const { appError, ErrorCodes } = require('../utils/errors');

/**
 * Zod validation middleware.
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'query'|'params'} source – which part of req to validate
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return next(appError(ErrorCodes.VALIDATION_ERROR, messages));
    }
    req[source] = result.data; // replace with parsed (coerced) data
    next();
  };
}

module.exports = validate;
