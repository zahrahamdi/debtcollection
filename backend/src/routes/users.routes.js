'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { authorize } = require('../middleware/auth.middleware');
const {
  assignRoleToUser,
  removeRoleFromUser,
  countAdmins,
  loadUserAuthPayload,
} = require('../services/auth.service');

router.use(authorize('admin_panel', 'view'));

/**
 * GET /api/users?has_role=true|false&without_role=negotiator
 */
router.get('/', (req, res) => {
  try {
    const hasRole = req.query.has_role;
    const withoutRole = req.query.without_role;
    let users = query(
      `SELECT u.id, u.first_name, u.last_name, u.username, u.email, u.is_active, u.is_super_admin, u.created_at
       FROM users u
       ORDER BY u.created_at DESC`
    );

    const userRoles = (userId) =>
      query(
        `SELECT r.name FROM roles r
         INNER JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $id`,
        { $id: userId }
      ).map((r) => r.name);

    if (hasRole === 'true') {
      users = users.filter((u) => userRoles(u.id).length > 0);
    } else if (hasRole === 'false') {
      users = users.filter((u) => userRoles(u.id).length === 0);
    }

    if (withoutRole) {
      users = users.filter((u) => !userRoles(u.id).includes(withoutRole));
      users = users.filter(
        (u) => !query('SELECT id FROM negotiators WHERE user_id = $id', { $id: u.id }).length
      );
    }

    const data = users.map((u) => {
      const payload = loadUserAuthPayload(u.id);
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.username,
        email: u.email,
        is_active: Boolean(u.is_active),
        is_super_admin: Boolean(u.is_super_admin),
        created_at: u.created_at,
        roles: payload?.roles ?? [],
        negotiator_id: payload?.negotiator_id ?? null,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('[GET /api/users]', err);
    res.status(500).json({ error: 'خطا در دریافت کاربران' });
  }
});

/**
 * POST /api/users/:id/assign-admin
 */
router.post('/:id/assign-admin', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const user = query('SELECT id FROM users WHERE id = $id', { $id: userId });
    if (!user.length) return res.status(404).json({ error: 'کاربر یافت نشد' });

    assignRoleToUser(userId, 'admin');
    res.json({ data: loadUserAuthPayload(userId), message: 'نقش ادمین تخصیص یافت' });
  } catch (err) {
    console.error('[POST /api/users/:id/assign-admin]', err);
    res.status(500).json({ error: 'خطا در تخصیص نقش ادمین' });
  }
});

/**
 * DELETE /api/users/:id/remove-admin
 */
router.delete('/:id/remove-admin', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const user = query('SELECT id, is_super_admin FROM users WHERE id = $id', { $id: userId });
    if (!user.length) return res.status(404).json({ error: 'کاربر یافت نشد' });

    if (user[0].is_super_admin) {
      return res.status(403).json({ error: 'این کاربر سوپر ادمین است و نقش آن قابل تغییر نیست.' });
    }

    const adminRoles = query(
      `SELECT ur.user_id FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'admin' AND ur.user_id = $id`,
      { $id: userId }
    );
    if (!adminRoles.length) {
      return res.status(400).json({ error: 'این کاربر ادمین نیست' });
    }

    if (countAdmins() <= 1) {
      return res.status(400).json({ error: 'نمی‌توان نقش admin را از آخرین ادمین گرفت' });
    }

    removeRoleFromUser(userId, 'admin');
    res.json({ data: loadUserAuthPayload(userId), message: 'نقش ادمین حذف شد' });
  } catch (err) {
    console.error('[DELETE /api/users/:id/remove-admin]', err);
    res.status(500).json({ error: 'خطا در حذف نقش ادمین' });
  }
});

module.exports = router;
