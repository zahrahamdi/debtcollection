import client from './client'

// دریافت لیست پرونده‌ها با فیلتر و pagination
// filters: { debtor_name, national_code, credit_id, case_status, action_status, negotiator_name }
// page: شماره صفحه (پیش‌فرض ۱)
export async function fetchCases(filters = {}, page = 1) {
  const params = { ...filters, page }
  // حذف مقادیر خالی از query string
  Object.keys(params).forEach((k) => {
    if (params[k] === '' || params[k] == null) delete params[k]
  })
  const { data } = await client.get('/cases', { params })
  return {
    data: data?.data ?? [],
    count: data?.count ?? 0,
    page: data?.page ?? 1,
    total_pages: data?.total_pages ?? 1,
  }
}

// دریافت تاریخچه کامل یک پرونده
export async function fetchCaseHistory(id) {
  const { data } = await client.get(`/cases/${id}/history`)
  return data?.data ?? []
}

// دریافت جزئیات کامل یک پرونده (برای ساید بار)
export async function fetchCaseById(id) {
  const { data } = await client.get(`/cases/${id}`)
  return data?.data ?? null
}

// تخصیص / تخصیص مجدد پرونده به مذاکره‌کننده
export async function assignCase(id, negotiatorId, userName) {
  const { data } = await client.post(`/cases/${id}/assign`, {
    negotiator_id: negotiatorId,
    user_name: userName,
  })
  return data?.data
}

// ثبت خروجی تماس مذاکره‌کننده
export async function submitCallOutcome(id, payload) {
  const { data } = await client.post(`/cases/${id}/call-outcome`, payload)
  return data?.data
}
