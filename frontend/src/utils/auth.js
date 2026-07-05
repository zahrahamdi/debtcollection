const TOKEN_KEY = 'digipay_token';
const USER_KEY = 'digipay_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setCurrentUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getCurrentUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload?.userId) return null;
  return { id: payload.userId };
}

export function getUserDisplayName(user = getCurrentUser()) {
  if (!user) return '';
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return name || user.username || '';
}

export function isAdmin(user = getCurrentUser()) {
  return Boolean(user?.roles?.includes('admin'));
}

export function isNegotiator(user = getCurrentUser()) {
  return Boolean(user?.roles?.includes('negotiator'));
}

export function hasPermission(resource, action, user = getCurrentUser()) {
  if (!user?.permissions) return false;
  if (isAdmin(user)) return true;
  return user.permissions.some((p) => p.resource === resource && p.action === action);
}

export function hasAnyRole(user = getCurrentUser()) {
  return Boolean(user?.roles?.length);
}

export function logout() {
  removeToken();
  window.location.href = '/login';
}

export const PASSWORD_RULES = [
  { key: 'length', label: 'حداقل ۸ کاراکتر', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'حداقل یک حرف بزرگ', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'حداقل یک حرف کوچک', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'حداقل یک عدد', test: (p) => /[0-9]/.test(p) },
  {
    key: 'special',
    label: 'حداقل یک کاراکتر خاص',
    test: (p) => /[@#!$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p),
  },
];

export function validatePassword(password) {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
}
