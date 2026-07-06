'use strict';

const { query } = require('../db/database');
const { verifyToken, loadUserAuthPayload, hasPermission } = require('../services/auth.service');

function extractToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'توکن احراز هویت یافت نشد' });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'توکن نامعتبر یا منقضی شده است' });
    }

    const user = loadUserAuthPayload(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'کاربر یافت نشد یا غیرفعال است' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[auth.authenticate]', err);
    res.status(500).json({ error: 'خطا در احراز هویت' });
  }
}

function authorize(resource, action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'احراز هویت نشده' });
    }
    if (req.user.roles?.includes('admin')) return next();
    if (hasPermission(req.user, resource, action)) return next();
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'احراز هویت نشده' });
  }
  if (!req.user.roles?.includes('admin')) {
    return res.status(403).json({ error: 'فقط ادمین مجاز است' });
  }
  next();
}

/** مذاکره‌کننده فقط پرونده‌های تخصیص‌یافته به خودش؛ ادمین همه */
function requireCallOutcomeAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'احراز هویت نشده' });
  }
  if (req.user.roles?.includes('admin')) return next();

  const id = Number(req.params.id);
  const row = query('SELECT assigned_negotiator_id FROM cases WHERE id = $id', { $id: id })[0];
  if (!row) return res.status(404).json({ error: 'پرونده یافت نشد' });

  if (
    req.user.negotiator_id != null &&
    row.assigned_negotiator_id != null &&
    Number(row.assigned_negotiator_id) === Number(req.user.negotiator_id)
  ) {
    return next();
  }
  return res.status(403).json({ error: 'دسترسی غیرمجاز' });
}

module.exports = {
  authenticate,
  authorize,
  requireAdmin,
  requireCallOutcomeAccess,
  extractToken,
};
