import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

import Login             from './pages/Login'
import Dashboard         from './pages/Dashboard'
import Users             from './pages/Users'
import Classes           from './pages/Classes'
import Students          from './pages/Students'
import StudentDetail     from './pages/StudentDetail'
import AttendanceSession from './pages/AttendanceSession'
import Reports           from './pages/Reports'
import Layout            from './components/Layout'

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        <p className="text-gray-500 text-sm">Loading…</p>
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
        <Route path="classes" element={<Classes />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="attendance/session/:classId" element={<AttendanceSession />} />
        <Route path="reports" element={<Reports />} />
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
