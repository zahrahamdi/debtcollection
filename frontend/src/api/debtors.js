import client from './client'

export async function fetchDebtors(filters = {}, page = 1, limit = 100) {
  const params = { ...filters, page, limit }
  Object.keys(params).forEach((k) => {
    if (params[k] === '' || params[k] == null) delete params[k]
  })
  const { data } = await client.get('/debtors', { params })
  return {
    data: data?.data ?? [],
    count: data?.count ?? 0,
    page: data?.page ?? 1,
    total_pages: data?.total_pages ?? 1,
    limit: data?.limit ?? limit,
  }
}

export async function fetchDebtorById(id) {
  const { data } = await client.get(`/debtors/${id}`)
  return data?.data ?? null
}

export async function addPhoneNumber(debtorId, phone) {
  const { data } = await client.post(`/debtors/${debtorId}/phone-numbers`, { phone })
  return data?.data
}
