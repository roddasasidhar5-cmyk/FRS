import { useEffect, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const TABS = { ATTENDANCE: 'attendance', VERIFICATIONS: 'verifications' }

export default function Reports() {
  const { user }  = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'

  const [tab, setTab]           = useState(TABS.ATTENDANCE)
  const [classes, setClasses]   = useState([])
  const [faculty, setFaculty]   = useState([])
  const [records, setRecords]   = useState([])
  const [verifs, setVerifs]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters]   = useState({ class_id: '', faculty_id: '', date_from: '', date_to: '' })

  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data)).catch(() => {})
    if (isSuperAdmin) api.get('/users').then(r => setFaculty(r.data)).catch(() => {})
  }, [isSuperAdmin])

  const loadAttendance = (f = filters) => {
    setLoading(true)
    const params = new URLSearchParams()
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v) })
    api.get(`/attendance/report?${params}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const loadVerifications = (f = filters) => {
    if (!isSuperAdmin) return
    setLoading(true)
    const params = new URLSearchParams()
    if (f.class_id)  params.set('class_id',  f.class_id)
    if (f.date_from) params.set('date_from',  f.date_from)
    if (f.date_to)   params.set('date_to',    f.date_to)
    api.get(`/faculty/verifications?${params}`)
      .then(r => setVerifs(r.data.verifications || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAttendance() }, [])

  const handleTabChange = t => {
    setTab(t)
    if (t === TABS.VERIFICATIONS) loadVerifications()
    else loadAttendance()
  }

  const clearFilters = () => {
    const empty = { class_id: '', faculty_id: '', date_from: '', date_to: '' }
    setFilters(empty)
    if (tab === TABS.ATTENDANCE) loadAttendance(empty)
    else loadVerifications(empty)
  }

  const hasFilters = Object.values(filters).some(Boolean)

  const exportUrl = fmt => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/api/attendance/export/${fmt}?${params}`
  }

  return (
    <div className="space-y-5 animate-slide-up">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-gray-500 text-sm mt-1">
            {tab === TABS.ATTENDANCE
              ? `${records.length} attendance record${records.length !== 1 ? 's' : ''}`
              : `${verifs.length} faculty verification${verifs.length !== 1 ? 's' : ''}`}
            {hasFilters && <span className="ml-2 badge-blue">Filtered</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className={showFilters ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setShowFilters(s => !s)}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {showFilters ? 'Hide' : 'Filter'}
          </button>
          {tab === TABS.ATTENDANCE && (
            <>
              <a href={exportUrl('csv')} className="btn-secondary btn-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                CSV
              </a>
              <a href={exportUrl('pdf')} className="btn-secondary btn-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                PDF
              </a>
            </>
          )}
        </div>
      </div>

      {/* ── Tabs (super_admin sees both; faculty only sees Attendance) ── */}
      {isSuperAdmin && (
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {[
            { id: TABS.ATTENDANCE,     label: 'Student Attendance',       icon: '📋' },
            { id: TABS.VERIFICATIONS,  label: 'Faculty Verifications',    icon: '🔐' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                ${tab === t.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      {showFilters && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/20 animate-slide-up">
          <h3 className="font-semibold text-gray-800 mb-3 text-sm">Filter Records</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">Class</label>
              <select className="input select text-sm" value={filters.class_id}
                onChange={e => setFilters(f => ({...f, class_id: e.target.value}))}>
                <option value="">All Classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
              </select>
            </div>
            {isSuperAdmin && tab === TABS.ATTENDANCE && (
              <div>
                <label className="label">Faculty</label>
                <select className="input select text-sm" value={filters.faculty_id}
                  onChange={e => setFilters(f => ({...f, faculty_id: e.target.value}))}>
                  <option value="">All Faculty</option>
                  {faculty.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">From Date</label>
              <input type="date" className="input text-sm" value={filters.date_from}
                onChange={e => setFilters(f => ({...f, date_from: e.target.value}))} />
            </div>
            <div>
              <label className="label">To Date</label>
              <input type="date" className="input text-sm" value={filters.date_to}
                onChange={e => setFilters(f => ({...f, date_to: e.target.value}))} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary btn-sm" onClick={() => {
              if (tab === TABS.ATTENDANCE) loadAttendance()
              else loadVerifications()
            }}>Apply</button>
            {hasFilters && (
              <button className="btn-secondary btn-sm" onClick={clearFilters}>Clear</button>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ STUDENT ATTENDANCE TABLE ══════════════ */}
      {tab === TABS.ATTENDANCE && (
        <>
          {/* Mobile */}
          <div className="sm:hidden space-y-2">
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : records.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="font-medium text-gray-500">No records found</p>
              </div>
            ) : records.map((r, i) => (
              <div key={i} className="card p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-brand-600 font-bold text-xs">{r.student_name?.[0]?.toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900">{r.student_name}</div>
                      <div className="text-xs text-gray-400">{r.roll_number} · {r.class_name} / {r.section}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="badge-green">{r.time}</span>
                    <div className="text-xs text-gray-400 mt-1">{r.date}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block card overflow-hidden">
            <div className="overflow-x-auto">
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
                  {loading ? (
                    <tr><td colSpan={5} className="py-16 text-center">
                      <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-200 border-t-brand-600" />
                      </div>
                    </td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={5} className="py-14 text-center text-gray-400">No records found.</td></tr>
                  ) : records.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                            <span className="text-brand-600 font-bold text-xs">{r.student_name?.[0]?.toUpperCase()}</span>
                          </div>
                          <span className="font-medium text-gray-900">{r.student_name}</span>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-gray-500">{r.roll_number}</td>
                      <td><span className="badge-blue">{r.class_name} / {r.section}</span></td>
                      <td className="text-gray-500">{r.date}</td>
                      <td><span className="badge-green">{r.time}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════ FACULTY VERIFICATIONS (super_admin only) ══════════════ */}
      {tab === TABS.VERIFICATIONS && isSuperAdmin && (
        <>
          <div className="alert-info text-sm flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd" />
            </svg>
            <span>
              This log records each faculty member's biometric face verification per session.
              <strong className="ml-1">Visible to Super Admin only.</strong> Faculty members cannot see this data.
            </span>
          </div>

          {/* Mobile */}
          <div className="sm:hidden space-y-2">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : verifs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <p className="font-medium text-gray-500">No verification records yet</p>
              </div>
            ) : verifs.map((v, i) => (
              <div key={i} className="card p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900">{v.faculty_name || v.username}</div>
                      <div className="text-xs text-gray-400">{v.class_name} / {v.section}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="badge-blue">{v.time}</span>
                    <div className="text-xs text-gray-400 mt-1">{v.date}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Faculty</th>
                    <th>Username</th>
                    <th>Class</th>
                    <th>Date</th>
                    <th>Verified At</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="py-16 text-center">
                      <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-200 border-t-brand-600" />
                      </div>
                    </td></tr>
                  ) : verifs.length === 0 ? (
                    <tr><td colSpan={5} className="py-14 text-center text-gray-400">No verification records yet.</td></tr>
                  ) : verifs.map((v, i) => (
                    <tr key={i}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                            <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                          </div>
                          <span className="font-medium text-gray-900">{v.faculty_name || v.username}</span>
                        </div>
                      </td>
                      <td className="text-gray-500">@{v.username}</td>
                      <td><span className="badge-blue">{v.class_name} / {v.section}</span></td>
                      <td className="text-gray-500">{v.date}</td>
                      <td>
                        <span className="badge-blue">{v.time}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
