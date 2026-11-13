'use strict';

const { validationError } = require('../lib/errors');

/**
 * Validates req.body / req.query / req.params against Zod schemas.
 * Parsed (coerced, stripped) values replace the originals on `req.valid`.
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        return next(
          validationError(
            result.error.issues.map((i) => ({ location: part, path: i.path.join('.'), message: i.message }))
          )
        );
      }
      req.valid[part] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
