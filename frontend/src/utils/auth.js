export { useAuth } from '../context/AuthContext'

export function getUserDisplayName(user) {
  if (!user) return ''
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
  return name || user.username || ''
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
]

export function validatePassword(password) {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label)
}
