import client from './client'
import { setToken, setCurrentUser, removeToken } from '../utils/auth'

export async function login(username, password) {
  const { data } = await client.post('/auth/login', { username, password })
  const { token, user } = data.data
  setToken(token)
  setCurrentUser(user)
  return user
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
  setCurrentUser(data.data)
  return data.data
}

export function logout() {
  removeToken()
}
