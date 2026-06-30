import { Routes, Route, Navigate } from 'react-router-dom'
import Cases from '../pages/Cases'
import Debtors from '../pages/Debtors'
import Negotiators from '../pages/Negotiators'
import Strategies from '../pages/Strategies'
import Installments from '../pages/Installments'
import History from '../pages/History'
import BulkOperations from '../pages/BulkOperations'
import AdminPanel from '../pages/AdminPanel'
import Reports from '../pages/Reports'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/cases" replace />} />
      <Route path="/cases" element={<Cases />} />
      <Route path="/debtors" element={<Debtors />} />
      <Route path="/negotiators" element={<Negotiators />} />
      <Route path="/strategies" element={<Strategies />} />
      <Route path="/installments" element={<Installments />} />
      <Route path="/history" element={<History />} />
      <Route path="/bulk-operations" element={<BulkOperations />} />
      <Route path="/admin" element={<AdminPanel />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="*" element={<Navigate to="/cases" replace />} />
    </Routes>
  )
}
