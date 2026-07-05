'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, run } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'digipay-secret-key';
const JWT_EXPIRES = '8h';

const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_SPECIAL_RE = /[@#!$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

function validatePasswordStrength(password) {
  const errors = [];
  if (!password || password.length < 8) errors.push('حداقل ۸ کاراکتر');
  if (!/[A-Z]/.test(password)) errors.push('حداقل یک حرف بزرگ');
  if (!/[a-z]/.test(password)) errors.push('حداقل یک حرف کوچک');
  if (!/[0-9]/.test(password)) errors.push('حداقل یک عدد');
  if (!PASSWORD_SPECIAL_RE.test(password)) errors.push('حداقل یک کاراکتر خاص');
  return errors;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(userId, extraClaims = {}) {
  return jwt.sign({ userId, ...extraClaims }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function userDisplayName(user) {
  if (!user) return 'سیستم';
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'کاربر';
}

function loadUserAuthPayload(userId) {
  const rows = query(
    `SELECT id, first_name, last_name, username, email, is_active, is_super_admin
     FROM users WHERE id = $id`,
    { $id: userId }
  );
  if (!rows.length) return null;
  const user = rows[0];

  const roleRows = query(
    `SELECT r.id, r.name, r.description
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $uid`,
    { $uid: userId }
  );

  const permRows = query(
    `SELECT DISTINCT p.resource, p.action
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $uid`,
    { $uid: userId }
  );

  const neg = query('SELECT id FROM negotiators WHERE user_id = $uid', { $uid: userId })[0];

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email,
    is_active: Boolean(user.is_active),
    is_super_admin: Boolean(user.is_super_admin),
    roles: roleRows.map((r) => r.name),
    permissions: permRows.map((p) => ({ resource: p.resource, action: p.action })),
    negotiator_id: neg?.id ?? null,
  };
}

function hasPermission(user, resource, action) {
  if (!user?.permissions) return false;
  return user.permissions.some((p) => p.resource === resource && p.action === action);
}

function assignRoleToUser(userId, roleName) {
  const role = query('SELECT id FROM roles WHERE name = $name', { $name: roleName })[0];
  if (!role) throw new Error(`Role not found: ${roleName}`);
  run(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ($uid, $rid)`,
    { $uid: userId, $rid: role.id }
  );
}

function removeRoleFromUser(userId, roleName) {
  const role = query('SELECT id FROM roles WHERE name = $name', { $name: roleName })[0];
  if (!role) return;
  run('DELETE FROM user_roles WHERE user_id = $uid AND role_id = $rid', {
    $uid: userId,
    $rid: role.id,
  });
}

function countAdmins() {
  return query(
    `SELECT COUNT(DISTINCT ur.user_id) AS c
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'admin'`
  )[0]?.c ?? 0;
}

module.exports = {
  JWT_SECRET,
  USERNAME_RE,
  EMAIL_RE,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  userDisplayName,
  loadUserAuthPayload,
  hasPermission,
  assignRoleToUser,
  removeRoleFromUser,
  countAdmins,
};
