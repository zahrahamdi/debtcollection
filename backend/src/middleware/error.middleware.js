'use strict';

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'خطای داخلی سرور';

  console.error(`[Error] ${req.method} ${req.path}:`, err.message);

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = { errorHandler };
