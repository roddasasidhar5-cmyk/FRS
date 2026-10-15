import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

import Login                  from './pages/Login'
import Dashboard              from './pages/Dashboard'
import Users                  from './pages/Users'
import UserDetail             from './pages/UserDetail'
import Classes                from './pages/Classes'
import Students               from './pages/Students'
import StudentDetail          from './pages/StudentDetail'
import AttendanceSession      from './pages/AttendanceSession'
import Reports                from './pages/Reports'
import AttendancePercentage   from './pages/AttendancePercentage'
import Layout                 from './components/Layout'

// Show spinner while /api/me is in-flight. Once resolved (user or null), render routes.
function ProtectedRoute({ children, requiredRole }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-glow">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-brand-200 border-t-brand-600" />
        <p className="text-gray-400 text-sm font-medium">Loading AttendAI…</p>
      </div>
    </div>
  )

  return (
    <Routes>
      <Route path="/login" element={
        user ? <Navigate to="/" replace /> : <Login />
      } />

      <Route path="/" element={
        <ProtectedRoute><Layout /></ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="users" element={
          <ProtectedRoute requiredRole="super_admin"><Users /></ProtectedRoute>
        } />
        <Route path="users/:id" element={
          <ProtectedRoute requiredRole="super_admin"><UserDetail /></ProtectedRoute>
        } />
        <Route path="classes" element={<Classes />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="attendance/session/:classId" element={<AttendanceSession />} />
        <Route path="reports" element={<Reports />} />
        <Route path="attendance/percentage" element={
          <ProtectedRoute requiredRole="super_admin"><AttendancePercentage /></ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
