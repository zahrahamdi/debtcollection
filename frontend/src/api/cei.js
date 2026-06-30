import client from './client'

// دریافت فرمول فعال + تاریخچه نسخه‌ها برای وام و BNPL
export async function fetchCeiFormulas() {
  const { data } = await client.get('/cei-formulas')
  return data?.data ?? {}
}

// ذخیره فرمول → ساخت نسخه جدید
export async function updateCeiFormula(creditType, params, userName, changeNote) {
  const { data } = await client.put('/cei-formulas', {
    credit_type: creditType,
    params,
    user_name: userName,
    change_note: changeNote,
  })
  return data?.data ?? null
}

// پیش‌نمایش CEI برای یک شناسه اعتبار (بدون اعمال تغییر)
export async function testCeiFormula(creditType, creditId) {
  const { data } = await client.post('/cei-formulas/test', {
    credit_type: creditType,
    credit_id: creditId,
  })
  return data?.data ?? null
}
