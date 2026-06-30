import client from './client'

export async function fetchNegotiators() {
  const { data } = await client.get('/negotiators')
  return data?.data ?? []
}

export async function createNegotiator(payload) {
  const { data } = await client.post('/negotiators', payload)
  return data?.data
}

export async function updateNegotiator(id, payload) {
  const { data } = await client.put(`/negotiators/${id}`, payload)
  return data?.data
}
