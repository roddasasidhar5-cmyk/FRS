import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { to: '/',         label: 'Dashboard', icon: '🏠', roles: ['super_admin', 'faculty'] },
  { to: '/users',    label: 'Faculty',   icon: '👥', roles: ['super_admin'] },
  { to: '/classes',  label: 'Classes',   icon: '🏫', roles: ['super_admin', 'faculty'] },
  { to: '/students', label: 'Students',  icon: '🎓', roles: ['super_admin', 'faculty'] },
  { to: '/reports',  label: 'Reports',   icon: '📊', roles: ['super_admin', 'faculty'] },
]

function NavItems({ user, onNavigate }) {
  return (
    <>
      {navItems.map(item =>
        item.roles.includes(user?.role) ? (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all
               ${isActive
                 ? 'bg-blue-700 text-white font-semibold'
                 : 'text-blue-200 hover:bg-blue-800 hover:text-white'}`
            }
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </NavLink>
        ) : null
      )}
    </>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">

      {/* ── MOBILE TOP BAR ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-blue-900 text-white sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎓</span>
          <span className="font-bold tracking-tight">AttendAI</span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg hover:bg-blue-800 transition"
          aria-label="Open menu"
        >
          {/* Hamburger */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* ── MOBILE DRAWER OVERLAY ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={closeDrawer}
        />
      )}

      {/* ── MOBILE DRAWER + DESKTOP SIDEBAR ── */}
      <aside className={`
        fixed top-0 left-0 h-full z-50 w-64 bg-blue-900 text-white flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:w-60 md:flex md:flex-shrink-0
      `}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-800">
          <div>
            <div className="text-lg font-bold tracking-tight">🎓 AttendAI</div>
            <div className="text-xs text-blue-300">Smart Attendance System</div>
          </div>
          {/* Close button — mobile only */}
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-blue-800 transition"
            onClick={closeDrawer}
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavItems user={user} onNavigate={closeDrawer} />
        </nav>

        {/* User profile + logout */}
        <div className="px-4 py-4 border-t border-blue-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{user?.full_name || user?.username}</div>
              <div className="text-xs text-blue-300 capitalize">{user?.role?.replace('_', ' ')}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                       bg-blue-800 hover:bg-blue-700 text-white text-sm transition"
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
