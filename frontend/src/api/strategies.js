import client from './client'

export async function fetchStrategies() {
  const { data } = await client.get('/strategies')
  return data?.data ?? []
}

export async function fetchStrategyById(id) {
  const { data } = await client.get(`/strategies/${id}`)
  return data?.data ?? null
}

export async function createStrategy(payload) {
  const { data } = await client.post('/strategies', payload)
  return data?.data
}

export async function updateStrategy(id, payload) {
  const { data } = await client.put(`/strategies/${id}`, payload)
  return data?.data
}

export async function deleteStrategy(id) {
  const { data } = await client.delete(`/strategies/${id}`)
  return data?.data
}
