import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import client from '../api/client'
import { getUserDisplayName as formatUserDisplayName } from '../utils/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await client.get('/auth/me')
      setUser(data.data)
      return data.data
    } catch {
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [refreshUser])

  const login = useCallback(
    async (username, password) => {
      await client.post('/auth/login', { username, password })
      return refreshUser()
    },
    [refreshUser]
  )

  const logout = useCallback(async () => {
    try {
      await client.post('/auth/logout')
    } catch {
      /* ignore */
    }
    setUser(null)
    window.location.href = '/login'
  }, [])

  const isAdmin = useCallback(() => Boolean(user?.roles?.includes('admin')), [user])

  const isNegotiator = useCallback(() => Boolean(user?.roles?.includes('negotiator')), [user])

  const hasPermission = useCallback(
    (resource, action) => {
      if (!user?.permissions) return false
      if (user.roles?.includes('admin')) return true
      return user.permissions.some((p) => p.resource === resource && p.action === action)
    },
    [user]
  )

  const hasAnyRole = useCallback(() => Boolean(user?.roles?.length), [user])

  const getUserDisplayName = useCallback(() => formatUserDisplayName(user), [user])

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      isAdmin,
      isNegotiator,
      hasPermission,
      hasAnyRole,
      getUserDisplayName,
    }),
    [
      user,
      loading,
      login,
      logout,
      refreshUser,
      isAdmin,
      isNegotiator,
      hasPermission,
      hasAnyRole,
      getUserDisplayName,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
