import { Navigate, Outlet } from 'react-router-dom'
import { getToken, hasAnyRole, isAdmin } from '../utils/auth'

export default function ProtectedRoute({ adminOnly = false }) {
  const token = getToken()

  if (!token) {
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
