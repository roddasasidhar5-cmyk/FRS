import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

function StatCard({ icon, label, value, color }) {
  return (
    <div className="card p-4 sm:p-6 flex items-center gap-3 sm:gap-4">
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-xl sm:text-2xl flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-xl sm:text-2xl font-bold text-gray-900">{value ?? '—'}</div>
        <div className="text-xs sm:text-sm text-gray-500">{label}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    api.get('/dashboard').then(r => {
      setStats(r.data)
      setRecent(r.data.recent || [])
    }).catch(() => {})
  }, [])

  const isSuperAdmin = user?.role === 'super_admin'

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Welcome back, {user?.full_name || user?.username} 👋
        </h1>
        <p className="text-gray-500 mt-0.5 text-sm capitalize">{user?.role?.replace('_', ' ')}</p>
      </div>

      {/* Stats grid — 2 cols on mobile, 4 on desktop */}
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 mb-6 ${isSuperAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <StatCard icon="🎓" label="Total Students"  value={stats?.total_students}  color="bg-blue-50" />
        <StatCard icon="🏫" label="Total Classes"   value={stats?.total_classes}   color="bg-purple-50" />
        <StatCard icon="✅" label="Present Today"   value={stats?.today_count}     color="bg-green-50" />
        {isSuperAdmin && (
          <StatCard icon="👨‍🏫" label="Faculty Members" value={stats?.total_faculty} color="bg-orange-50" />
        )}
      </div>

      {/* Quick actions + today's activity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="card p-4 sm:p-5">
          <h3 className="font-semibold text-gray-700 mb-3 text-sm sm:text-base">Quick Actions</h3>
          <div className="space-y-2">
            <Link to="/classes" className="btn-primary btn-sm w-full text-sm">
              📷 Start Attendance Session
            </Link>
            <Link to="/students" className="btn-secondary btn-sm w-full text-sm">
              🎓 Manage Students
            </Link>
            <Link to="/reports" className="btn-secondary btn-sm w-full text-sm">
              📊 View Reports
            </Link>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="font-semibold text-gray-700 mb-3 text-sm sm:text-base">Today's Activity</h3>
          {recent.length === 0 ? (
            <p className="text-gray-400 text-sm">No attendance marked today yet.</p>
          ) : (
            <div className="space-y-2 max-h-44 overflow-auto">
              {recent.slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="min-w-0 mr-2">
                    <span className="font-medium truncate block">{r.student_name}</span>
                    <span className="text-gray-400 text-xs">{r.class_name} / {r.section}</span>
                  </div>
                  <span className="badge-green flex-shrink-0">{r.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent attendance — card list on mobile, table on desktop */}
      {recent.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-700">Recent Attendance</h3>
          </div>

          {/* Mobile: card list */}
          <div className="sm:hidden divide-y divide-gray-50">
            {recent.map((r, i) => (
              <div key={i} className="px-4 py-3 flex justify-between items-center">
                <div>
                  <div className="font-medium text-sm">{r.student_name}</div>
                  <div className="text-xs text-gray-400">{r.roll_number} · {r.class_name} / {r.section}</div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <span className="badge-green text-xs">{r.time}</span>
                  <div className="text-xs text-gray-400 mt-0.5">{r.date}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 text-left">Student</th>
                  <th className="px-6 py-3 text-left">Roll No</th>
                  <th className="px-6 py-3 text-left">Class</th>
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-left">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium">{r.student_name}</td>
                    <td className="px-6 py-3 text-gray-500">{r.roll_number}</td>
                    <td className="px-6 py-3">{r.class_name} / {r.section}</td>
                    <td className="px-6 py-3 text-gray-500">{r.date}</td>
                    <td className="px-6 py-3"><span className="badge-green">{r.time}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
