import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'

// ── helpers ──────────────────────────────────────────────────────────────────
const statusMeta = {
  Good:     { bar: 'bg-emerald-500', badge: 'badge-green',  label: 'Good ≥ 75%' },
  Low:      { bar: 'bg-amber-400',   badge: 'badge-yellow', label: 'Low 65–74%' },
  Critical: { bar: 'bg-red-500',     badge: 'badge-red',    label: 'Critical < 65%' },
  'No Data':{ bar: 'bg-gray-300',    badge: 'badge-gray',   label: 'No sessions yet' },
}

function PctBar({ pct }) {
  const clamped = Math.min(Math.max(pct ?? 0, 0), 100)
  const color =
    pct === null  ? 'bg-gray-300' :
    pct >= 75     ? 'bg-emerald-500' :
    pct >= 65     ? 'bg-amber-400' :
                    'bg-red-500'

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`text-xs font-bold w-10 text-right
        ${pct === null ? 'text-gray-400' : pct >= 75 ? 'text-emerald-600' : pct >= 65 ? 'text-amber-600' : 'text-red-600'}`}>
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  )
}

export default function AttendancePercentage() {
  const [data, setData]       = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [classFilter, setClassFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch]   = useState('')

  const load = (cid = classFilter) => {
    setLoading(true)
    const params = cid ? `?class_id=${cid}` : ''
    api.get(`/attendance/percentage${params}`)
      .then(r => setData(r.data.students || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data)).catch(() => {})
    load()
  }, [])

  // ── summary stats ──────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total    = data.length
    const good     = data.filter(s => s.status === 'Good').length
    const low      = data.filter(s => s.status === 'Low').length
    const critical = data.filter(s => s.status === 'Critical').length
    const nodata   = data.filter(s => s.status === 'No Data').length
    const avgPct   = data.filter(s => s.percentage !== null).length
      ? (data.filter(s => s.percentage !== null)
             .reduce((a, s) => a + s.percentage, 0) /
         data.filter(s => s.percentage !== null).length).toFixed(1)
      : null
    return { total, good, low, critical, nodata, avgPct }
  }, [data])

  // ── filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return data.filter(s => {
      const matchSearch = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.roll_number.toLowerCase().includes(search.toLowerCase())
      const matchStatus = !statusFilter || s.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [data, search, statusFilter])

  const handleClassChange = e => {
    setClassFilter(e.target.value)
    load(e.target.value)
  }

  return (
    <div className="space-y-6 animate-slide-up">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Percentage</h1>
          <p className="text-gray-500 text-sm mt-1">
            Per-student attendance breakdown · 75% minimum required
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Students', value: summary.total,    color: 'from-brand-500 to-brand-700',   textColor: 'text-white' },
          { label: 'Good  ≥ 75%',    value: summary.good,     color: 'from-emerald-500 to-teal-600',  textColor: 'text-white' },
          { label: 'Low  65–74%',    value: summary.low,      color: 'from-amber-400 to-orange-500',  textColor: 'text-white' },
          { label: 'Critical < 65%', value: summary.critical, color: 'from-red-500 to-rose-600',      textColor: 'text-white' },
        ].map(card => (
          <div key={card.label}
            className={`rounded-2xl p-4 bg-gradient-to-br ${card.color} text-white shadow-sm relative overflow-hidden`}>
            <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-white/10" />
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-xs text-white/70 mt-0.5 font-medium">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Average banner */}
      {summary.avgPct && (
        <div className="card p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <div className="text-sm text-gray-500 font-medium">Class Average Attendance</div>
            <div className={`text-2xl font-bold ${
              Number(summary.avgPct) >= 75 ? 'text-emerald-600' :
              Number(summary.avgPct) >= 65 ? 'text-amber-600'   : 'text-red-600'}`}>
              {summary.avgPct}%
            </div>
          </div>
          <div className="flex-1 ml-2">
            <PctBar pct={Number(summary.avgPct)} />
          </div>
          {summary.critical > 0 && (
            <div className="flex-shrink-0 alert-warning py-2 px-3 text-xs">
              ⚠️ {summary.critical} student{summary.critical !== 1 ? 's' : ''} below 65%
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input className="input pl-9" placeholder="Search student or roll no…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input select max-w-[200px]" value={classFilter} onChange={handleClassChange}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
        </select>
        <select className="input select max-w-[180px]" value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="Good">Good ≥ 75%</option>
          <option value="Low">Low 65–74%</option>
          <option value="Critical">Critical &lt; 65%</option>
          <option value="No Data">No Sessions</option>
        </select>
        {(search || statusFilter) && (
          <button className="btn-secondary btn-sm"
            onClick={() => { setSearch(''); setStatusFilter('') }}>
            Clear
          </button>
        )}
      </div>

      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-200 border-t-brand-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="font-medium text-gray-500">No data found</p>
          </div>
        ) : filtered.map(s => (
          <div key={s.student_id} className="card p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                  ${s.status === 'Good' ? 'bg-emerald-50' : s.status === 'Low' ? 'bg-amber-50' : s.status === 'Critical' ? 'bg-red-50' : 'bg-gray-100'}`}>
                  <span className={`font-bold text-sm
                    ${s.status === 'Good' ? 'text-emerald-600' : s.status === 'Low' ? 'text-amber-600' : s.status === 'Critical' ? 'text-red-600' : 'text-gray-400'}`}>
                    {s.name[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <Link to={`/students/${s.student_id}`}
                    className="font-medium text-sm text-gray-900 hover:text-brand-600 truncate block">
                    {s.name}
                  </Link>
                  <div className="text-xs text-gray-400">{s.roll_number} · {s.class_name} / {s.section}</div>
                </div>
              </div>
              <span className={`flex-shrink-0 ${statusMeta[s.status]?.badge ?? 'badge-gray'}`}>
                {s.status}
              </span>
            </div>
            <PctBar pct={s.percentage} />
            <div className="text-xs text-gray-400 mt-2">
              {s.attended}/{s.total_sessions} sessions attended
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Roll No</th>
                <th>Class</th>
                <th>Sessions</th>
                <th>Attendance %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-200 border-t-brand-600" />
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-gray-400">No data found.</td>
                </tr>
              ) : filtered.map(s => (
                <tr key={s.student_id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                        ${s.status === 'Good' ? 'bg-emerald-50' : s.status === 'Low' ? 'bg-amber-50' : s.status === 'Critical' ? 'bg-red-50' : 'bg-gray-100'}`}>
                        <span className={`font-bold text-xs
                          ${s.status === 'Good' ? 'text-emerald-600' : s.status === 'Low' ? 'text-amber-600' : s.status === 'Critical' ? 'text-red-600' : 'text-gray-400'}`}>
                          {s.name[0].toUpperCase()}
                        </span>
                      </div>
                      <Link to={`/students/${s.student_id}`}
                        className="font-medium text-gray-900 hover:text-brand-600 transition">
                        {s.name}
                      </Link>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-500">{s.roll_number}</td>
                  <td><span className="badge-blue">{s.class_name} / {s.section}</span></td>
                  <td>
                    <span className="text-gray-700 font-medium">{s.attended}</span>
                    <span className="text-gray-400"> / {s.total_sessions}</span>
                  </td>
                  <td className="min-w-[160px]"><PctBar pct={s.percentage} /></td>
                  <td>
                    <span className={statusMeta[s.status]?.badge ?? 'badge-gray'}>
                      {s.percentage !== null ? `${s.percentage}%` : '—'} · {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-4 text-xs text-gray-500">
          {Object.entries(statusMeta).map(([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${meta.bar}`} />
              {meta.label}
            </div>
          ))}
          <span className="ml-auto text-gray-400">
            Showing {filtered.length} of {data.length} students
          </span>
        </div>
      </div>
    </div>
  )
}
