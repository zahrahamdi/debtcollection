import client from './client'

// دریافت همه تنظیمات به صورت آبجکت key→value
export async function fetchSettings() {
  const { data } = await client.get('/settings')
  return data?.data ?? {}
}

// به‌روزرسانی یک یا چند تنظیم
export async function updateSettings(changes) {
  const { data } = await client.put('/settings', { changes })
  return data?.data ?? {}
}

// تاریخچه تغییرات یک کلید
export async function fetchSettingsHistory(key) {
  const { data } = await client.get('/settings/history', { params: key ? { key } : {} })
  return data?.data ?? []
}
