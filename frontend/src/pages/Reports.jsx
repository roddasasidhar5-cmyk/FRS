import { useEffect, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Reports() {
  const { user }  = useAuth()
  const [classes, setClasses]   = useState([])
  const [faculty, setFaculty]   = useState([])
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters]   = useState({ class_id: '', faculty_id: '', date_from: '', date_to: '' })
  const isSuperAdmin = user?.role === 'super_admin'

  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data)).catch(() => {})
    if (isSuperAdmin) {
      api.get('/users').then(r => setFaculty(r.data)).catch(() => {})
    }
  }, [isSuperAdmin])

  const load = (f = filters) => {
    setLoading(true)
    const params = new URLSearchParams()
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v) })
    api.get(`/attendance/report?${params}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const clearFilters = () => {
    const empty = { class_id: '', faculty_id: '', date_from: '', date_to: '' }
    setFilters(empty); load(empty)
  }

  const exportUrl = fmt => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/api/attendance/export/${fmt}?${params}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Reports</h1>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setShowFilters(s => !s)}>
            🔍 {showFilters ? 'Hide' : 'Filter'}
          </button>
          <a href={exportUrl('csv')} className="btn-secondary btn-sm hidden sm:inline-flex">⬇ CSV</a>
          <a href={exportUrl('pdf')} className="btn-secondary btn-sm hidden sm:inline-flex">⬇ PDF</a>
        </div>
      </div>

      {/* Export buttons on mobile (full width) */}
      <div className="flex gap-2 mb-4 sm:hidden">
        <a href={exportUrl('csv')} className="btn-secondary btn-sm flex-1 text-center">⬇ CSV</a>
        <a href={exportUrl('pdf')} className="btn-secondary btn-sm flex-1 text-center">⬇ PDF</a>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">Class</label>
              <select className="input text-sm" value={filters.class_id}
                onChange={e => setFilters(f => ({...f, class_id: e.target.value}))}>
                <option value="">All Classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
              </select>
            </div>
            {isSuperAdmin && (
              <div>
                <label className="label">Faculty</label>
                <select className="input text-sm" value={filters.faculty_id}
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
          <div className="flex gap-2 mt-3">
            <button className="btn-primary btn-sm" onClick={() => load()}>Apply</button>
            <button className="btn-secondary btn-sm" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      )}

      {/* Record count */}
      <div className="flex items-center justify-between mb-3 text-sm text-gray-500">
        <span>{records.length} record{records.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Mobile: card list */}
      <div className="sm:hidden space-y-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-sm">No records found.</p>
          </div>
        ) : records.map((r, i) => (
          <div key={i} className="card p-4">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm">{r.student_name}</div>
                <div className="text-xs text-gray-400">{r.roll_number} · {r.class_name} / {r.section}</div>
                {isSuperAdmin && r.faculty_name && (
                  <div className="text-xs text-blue-500 mt-0.5">Faculty: {r.faculty_name}</div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <span className="badge-green text-xs">{r.time}</span>
                <div className="text-xs text-gray-400 mt-0.5">{r.date}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Student</th>
                <th className="px-5 py-3 text-left">Roll No</th>
                <th className="px-5 py-3 text-left">Class</th>
                {isSuperAdmin && <th className="px-5 py-3 text-left">Faculty</th>}
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={7} className="py-10 text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" />
                </td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No records found.</td></tr>
              ) : records.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{r.student_name}</td>
                  <td className="px-5 py-3 text-gray-500">{r.roll_number}</td>
                  <td className="px-5 py-3">{r.class_name} / {r.section}</td>
                  {isSuperAdmin && <td className="px-5 py-3 text-gray-500">{r.faculty_name || '—'}</td>}
                  <td className="px-5 py-3 text-gray-500">{r.date}</td>
                  <td className="px-5 py-3"><span className="badge-green">{r.time}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
