import client from './client'

export async function fetchAbTests() {
  const { data } = await client.get('/ab-tests')
  return data?.data ?? []
}

export async function createAbTest(payload) {
  const { data } = await client.post('/ab-tests', payload)
  return data?.data
}

export async function deleteAbTest(id) {
  const { data } = await client.delete(`/ab-tests/${id}`)
  return data?.data
}
