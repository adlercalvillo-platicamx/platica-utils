'use strict';

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'X-API-Key faltante o inválida.',
    });
  }

  next();
}

module.exports = authMiddleware;
