import client from './client'

// دریافت سگمنت‌ها به تفکیک نوع اعتبار
export async function fetchSegments() {
  const { data } = await client.get('/segments')
  return data?.data ?? { loan: [], bnpl: [] }
}

export async function createSegment(payload) {
  const { data } = await client.post('/segments', payload)
  return data?.data
}

export async function updateSegment(id, payload) {
  const { data } = await client.put(`/segments/${id}`, payload)
  return data?.data
}

export async function deleteSegment(id) {
  const { data } = await client.delete(`/segments/${id}`)
  return data?.data
}
