// نقش کاربر — فعلاً mock تا UI ادمین نمایش داده شود.
// در نسخه‌های بعدی از احراز هویت واقعی خوانده می‌شود.
export const currentUser = {
  name: 'زهرا حمیدی',
  role: 'admin', // admin | negotiator
}

export const isAdmin = () => currentUser.role === 'admin'
