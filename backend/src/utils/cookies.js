'use strict';

const TOKEN_COOKIE = 'token';
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    maxAge: TOKEN_MAX_AGE_MS,
    sameSite: 'lax',
    secure: isProd,
  });
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
  });
}

module.exports = {
  TOKEN_COOKIE,
  setAuthCookie,
  clearAuthCookie,
};
