'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { authenticate } = require('../middleware/auth.middleware');
const { setAuthCookie, clearAuthCookie } = require('../utils/cookies');
const {
  USERNAME_RE,
  EMAIL_RE,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  signToken,
  loadUserAuthPayload,
} = require('../services/auth.service');

/**
 * POST /api/auth/register
 */
router.post('/register', (req, res, next) => {
  try {
    const { first_name, last_name, username, email, password } = req.body || {};
    const fn = (first_name || '').trim();
    const ln = (last_name || '').trim();
    const un = (username || '').trim().toLowerCase();
    const em = (email || '').trim().toLowerCase();

    if (!fn || !ln || !un || !em || !password) {
      return res.status(400).json({ error: 'همه فیلدها اجباری هستند' });
    }
    if (!USERNAME_RE.test(un)) {
      return res.status(400).json({
        error: 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد، نقطه و خط تیره باشد',
      });
    }
    if (!EMAIL_RE.test(em)) {
      return res.status(400).json({ error: 'فرمت ایمیل نامعتبر است' });
    }
    const pwErrors = validatePasswordStrength(password);
    if (pwErrors.length) {
      return res.status(400).json({ error: `رمز عبور ضعیف است: ${pwErrors.join('، ')}` });
    }

    if (query('SELECT id FROM users WHERE username = $u', { $u: un }).length) {
      return res.status(409).json({ error: 'نام کاربری تکراری است' });
    }
    if (query('SELECT id FROM users WHERE email = $e', { $e: em }).length) {
      return res.status(409).json({ error: 'ایمیل تکراری است' });
    }

    const { lastInsertRowid } = run(
      `INSERT INTO users (first_name, last_name, username, email, password_hash)
       VALUES ($fn, $ln, $un, $em, $ph)`,
      { $fn: fn, $ln: ln, $un: un, $em: em, $ph: hashPassword(password) }
    );

    const token = signToken(lastInsertRowid, { has_role: false });
    setAuthCookie(res, token);

    res.status(201).json({
      message: 'ثبت‌نام موفق. منتظر تخصیص نقش از سمت ادمین باشید.',
      data: { id: lastInsertRowid, has_role: false },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const un = (username || '').trim().toLowerCase();
    if (!un || !password) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور اجباری است' });
    }

    const rows = query('SELECT * FROM users WHERE username = $u', { $u: un });
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }
    if (!rows[0].is_active) {
      return res.status(401).json({ error: 'حساب کاربری غیرفعال است' });
    }

    const user = loadUserAuthPayload(rows[0].id);
    const token = signToken(rows[0].id);
    setAuthCookie(res, token);

    res.json({
      data: {
        has_role: user.roles.length > 0,
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          email: user.email,
          is_super_admin: user.is_super_admin,
          roles: user.roles,
          permissions: user.permissions,
          negotiator_id: user.negotiator_id,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', (req, res, next) => {
  try {
    const { email, new_password, confirm_password } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'همه فیلدها اجباری هستند' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'رمز عبور و تکرار آن یکسان نیستند' });
    }
    const pwErrors = validatePasswordStrength(new_password);
    if (pwErrors.length) {
      return res.status(400).json({ error: `رمز عبور ضعیف است: ${pwErrors.join('، ')}` });
    }

    const rows = query('SELECT id FROM users WHERE email = $e', { $e: em });
    if (!rows.length) {
      return res.status(404).json({ error: 'ایمیل در سیستم یافت نشد' });
    }

    run('UPDATE users SET password_hash = $ph WHERE id = $id', {
      $ph: hashPassword(new_password),
      $id: rows[0].id,
    });

    res.json({ message: 'رمز عبور با موفقیت تغییر کرد' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ data: req.user });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'خروج موفق' });
});

module.exports = router;
