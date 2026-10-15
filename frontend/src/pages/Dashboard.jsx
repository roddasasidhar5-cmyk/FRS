import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const STAT_CONFIG = [
  {
    key: 'total_students',
    label: 'Total Students',
    bg: 'from-brand-500 to-brand-700',
    iconBg: 'bg-white/20',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
      </svg>
    ),
  },
  {
    key: 'total_classes',
    label: 'Total Classes',
    bg: 'from-violet-500 to-purple-700',
    iconBg: 'bg-white/20',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    key: 'today_count',
    label: 'Present Today',
    bg: 'from-emerald-500 to-teal-600',
    iconBg: 'bg-white/20',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'total_faculty',
    label: 'Faculty Members',
    bg: 'from-orange-400 to-rose-500',
    iconBg: 'bg-white/20',
    roles: ['super_admin'],
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

function StatCard({ config, value }) {
  return (
    <div className={`rounded-2xl p-5 bg-gradient-to-br ${config.bg} text-white shadow-sm overflow-hidden relative`}>
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/5" />
      <div className="absolute -right-2 -bottom-6 w-32 h-32 rounded-full bg-white/5" />
      <div className="relative">
        <div className={`w-11 h-11 ${config.iconBg} rounded-xl flex items-center justify-center mb-3`}>
          {config.icon}
        </div>
        <div className="text-3xl font-bold tracking-tight">{value ?? '—'}</div>
        <div className="text-sm text-white/70 mt-1 font-medium">{config.label}</div>
      </div>
    </div>
  )
}

const quickActions = [
  {
    to: '/classes',
    label: 'Start Attendance',
    desc: 'Launch a face recognition session',
    color: 'bg-brand-500 hover:bg-brand-600',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    text: 'text-white',
  },
  {
    to: '/students',
    label: 'Manage Students',
    desc: 'Add, edit, enroll face photos',
    color: 'bg-white hover:bg-gray-50 border border-gray-200',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
      </svg>
    ),
    text: 'text-gray-700',
  },
  {
    to: '/reports',
    label: 'View Reports',
    desc: 'Export attendance records',
    color: 'bg-white hover:bg-gray-50 border border-gray-200',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    text: 'text-gray-700',
  },
]

export default function Dashboard() {
  const { user }  = useAuth()
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    api.get('/dashboard').then(r => {
      setStats(r.data)
      setRecent(r.data.recent || [])
    }).catch(() => {})
  }, [])

  const isSuperAdmin = user?.role === 'super_admin'
  const visibleStats = STAT_CONFIG.filter(s => !s.roles || s.roles.includes(user?.role))

  return (
    <div className="space-y-6 animate-slide-up">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            Welcome back, {user?.full_name?.split(' ')[0] || user?.username} 👋
          </h1>
          <p className="text-gray-500 mt-1 text-sm capitalize">
            {user?.role?.replace('_', ' ')} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link to="/classes"
          className="btn-primary gap-2 shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </Link>
      </div>

      {/* Stat cards */}
      <div className={`grid grid-cols-2 gap-4 ${isSuperAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {visibleStats.map(cfg => (
          <StatCard key={cfg.key} config={cfg} value={stats?.[cfg.key]} />
        ))}
      </div>

      {/* Quick actions + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Quick actions */}
        <div className="lg:col-span-2 card p-5">
          <h3 className="font-semibold text-gray-900 mb-4 text-base">Quick Actions</h3>
          <div className="space-y-2.5">
            {quickActions.map(a => (
              <Link key={a.to} to={a.to}
                className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all duration-150 ${a.color} ${a.text} group`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                  ${a.text === 'text-white' ? 'bg-white/20' : 'bg-gray-100 group-hover:bg-gray-200'} transition`}>
                  {a.icon}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{a.label}</div>
                  <div className={`text-xs mt-0.5 ${a.text === 'text-white' ? 'text-white/65' : 'text-gray-400'}`}>
                    {a.desc}
                  </div>
                </div>
                <svg className={`w-4 h-4 ml-auto flex-shrink-0 opacity-60 group-hover:translate-x-0.5 transition-transform
                  ${a.text === 'text-white' ? 'text-white' : 'text-gray-400'}`}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>

        {/* Today's activity */}
        <div className="lg:col-span-3 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 text-base">Today's Activity</h3>
            <span className="badge-green">{recent.filter(r => r.date === new Date().toISOString().slice(0,10)).length} today</span>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-300">
              <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">No attendance marked today yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-auto">
              {recent.slice(0, 8).map((r, i) => (
                <div key={i}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-brand-600 font-bold text-xs">
                        {r.student_name?.[0]?.toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">{r.student_name}</div>
                      <div className="text-xs text-gray-400">{r.class_name} / {r.section}</div>
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <span className="badge-green text-xs">{r.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent attendance table */}
      {recent.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Recent Attendance</h3>
            <Link to="/reports" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              View all →
            </Link>
          </div>

          {/* Mobile */}
          <div className="sm:hidden divide-y divide-gray-50">
            {recent.map((r, i) => (
              <div key={i} className="px-4 py-3.5 flex justify-between items-center hover:bg-gray-50 transition">
                <div>
                  <div className="font-medium text-sm text-gray-900">{r.student_name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.roll_number} · {r.class_name} / {r.section}</div>
                </div>
                <div className="text-right ml-2">
                  <span className="badge-green">{r.time}</span>
                  <div className="text-xs text-gray-400 mt-1">{r.date}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Roll No</th>
                  <th>Class</th>
                  <th>Date</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                          <span className="text-brand-600 font-bold text-xs">{r.student_name?.[0]?.toUpperCase()}</span>
                        </div>
                        <span className="font-medium text-gray-900">{r.student_name}</span>
                      </div>
                    </td>
                    <td className="text-gray-500 font-mono text-xs">{r.roll_number}</td>
                    <td>
                      <span className="badge-blue">{r.class_name} / {r.section}</span>
                    </td>
                    <td className="text-gray-500">{r.date}</td>
                    <td><span className="badge-green">{r.time}</span></td>
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
