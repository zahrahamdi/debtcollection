import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ adminOnly = false }) {
  const { user, hasAnyRole, isAdmin } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!hasAnyRole()) {
    return <Navigate to="/waiting" replace />
  }

  if (adminOnly && !isAdmin()) {
    return <Navigate to="/cases" replace />
  }

  return <Outlet />
}
