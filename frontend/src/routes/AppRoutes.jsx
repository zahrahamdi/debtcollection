import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from '../components/layout/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import Login from '../pages/Login'
import Register from '../pages/Register'
import ForgotPassword from '../pages/ForgotPassword'
import WaitingForRole from '../pages/WaitingForRole'
import Cases from '../pages/Cases'
import Debtors from '../pages/Debtors'
import Negotiators from '../pages/Negotiators'
import Strategies from '../pages/Strategies'
import Installments from '../pages/Installments'
import History from '../pages/History'
import BulkOperations from '../pages/BulkOperations'
import AdminPanel from '../pages/AdminPanel'
import Reports from '../pages/Reports'
import { getToken, hasAnyRole, setCurrentUser } from '../utils/auth'
import { getMe } from '../api/auth'

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/waiting']

function AuthBootstrap({ children }) {
  const [ready, setReady] = useState(false)
  const tried = useRef(false)
  const { pathname } = useLocation()

  useEffect(() => {
    if (tried.current) return
    tried.current = true
    const token = getToken()
    if (!token || AUTH_PATHS.includes(pathname)) {
      setReady(true)
      return
    }
    getMe()
      .catch(() => setCurrentUser(null))
      .finally(() => setReady(true))
  }, [pathname])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">در حال بارگذاری…</div>
    )
  }
  return children
}

function PublicOnly({ children }) {
  const token = getToken()
  if (token && hasAnyRole()) return <Navigate to="/cases" replace />
  if (token && !hasAnyRole()) return <Navigate to="/waiting" replace />
  return children
}

export default function AppRoutes() {
  return (
    <AuthBootstrap>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Register />
            </PublicOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnly>
              <ForgotPassword />
            </PublicOnly>
          }
        />
        <Route path="/waiting" element={<WaitingForRole />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/cases" replace />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/debtors" element={<Debtors />} />
            <Route path="/installments" element={<Installments />} />
            <Route path="/history" element={<History />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute adminOnly />}>
          <Route element={<Layout />}>
            <Route path="/negotiators" element={<Negotiators />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/bulk-operations" element={<BulkOperations />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/reports" element={<Reports />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/cases" replace />} />
      </Routes>
    </AuthBootstrap>
  )
}
