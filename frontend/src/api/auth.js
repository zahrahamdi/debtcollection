import client from './client'

export async function login(username, password) {
  const { data } = await client.post('/auth/login', { username, password })
  return data.data?.user ?? data.data
}

export async function register(formData) {
  const { data } = await client.post('/auth/register', formData)
  return data
}

export async function forgotPassword(email, newPassword, confirmPassword) {
  const { data } = await client.post('/auth/forgot-password', {
    email,
    new_password: newPassword,
    confirm_password: confirmPassword,
  })
  return data
}

export async function getMe() {
  const { data } = await client.get('/auth/me')
  return data.data
}

export async function logout() {
  await client.post('/auth/logout')
}
