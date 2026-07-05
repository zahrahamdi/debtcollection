import client from './client'

export async function fetchUsers(params = {}) {
  const { data } = await client.get('/users', { params })
  return data.data
}

export async function assignAdmin(userId) {
  const { data } = await client.post(`/users/${userId}/assign-admin`)
  return data
}

export async function removeAdmin(userId) {
  const { data } = await client.delete(`/users/${userId}/remove-admin`)
  return data
}
