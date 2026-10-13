import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Students() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const classFilter  = searchParams.get('class_id') || ''
  const [students, setStudents] = useState([])
  const [classes, setClasses]   = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ name: '', roll_number: '', class_id: classFilter })
  const [error, setError]       = useState('')
  const isSuperAdmin = user?.role === 'super_admin'

  const load = () => {
    const params = classFilter ? `?class_id=${classFilter}` : ''
    api.get(`/students${params}`).then(r => setStudents(r.data)).catch(() => {})
  }
  useEffect(() => { load() }, [classFilter])
  useEffect(() => { api.get('/classes').then(r => setClasses(r.data)).catch(() => {}) }, [])

  const handleAdd = async e => {
    e.preventDefault(); setError('')
    try {
      await api.post('/students', { ...form, class_id: Number(form.class_id) })
      setForm({ name: '', roll_number: '', class_id: classFilter })
      setShowForm(false); load()
    } catch (err) { setError(err.response?.data?.error || 'Failed') }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this student?')) return
    try { await api.delete(`/students/${id}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Students</h1>
        <button className="btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? '✕ Cancel' : '+ Add Student'}
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className="input max-w-[200px] sm:max-w-xs text-sm" value={classFilter}
          onChange={e => setSearchParams(e.target.value ? { class_id: e.target.value } : {})}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
        </select>
        {classFilter && (
          <button className="text-sm text-blue-600 hover:underline"
            onClick={() => setSearchParams({})}>Clear</button>
        )}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {showForm && (
        <div className="card p-4 sm:p-5 mb-5">
          <h2 className="font-semibold mb-3 text-sm sm:text-base">Add Student</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Full Name</label>
              <input className="input" required placeholder="Student name"
                value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div>
              <label className="label">Roll Number</label>
              <input className="input" required placeholder="CS2021001"
                value={form.roll_number} onChange={e => setForm(f => ({...f, roll_number: e.target.value}))} />
            </div>
            <div>
              <label className="label">Class</label>
              <select className="input" required value={form.class_id}
                onChange={e => setForm(f => ({...f, class_id: e.target.value}))}>
                <option value="">Select class</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3 flex gap-2">
              <button type="submit" className="btn-primary btn-sm">Add Student</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile: card list */}
      <div className="sm:hidden space-y-2">
        {students.map(s => (
          <div key={s.id} className="card p-4 flex justify-between items-center gap-3">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{s.name}</div>
              <div className="text-xs text-gray-400">{s.roll_number} · {s.class_name} / {s.section}</div>
              <span className={`mt-1 inline-block ${s.face_count > 0 ? 'badge-green' : 'badge-yellow'} text-xs`}>
                {s.face_count} {s.face_count === 1 ? 'photo' : 'photos'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Link to={`/students/${s.id}`} className="btn-secondary btn-sm text-xs px-3">View</Link>
              {isSuperAdmin && (
                <button className="btn-danger btn-sm text-xs px-3" onClick={() => handleDelete(s.id)}>Del</button>
              )}
            </div>
          </div>
        ))}
        {students.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-3xl mb-2">🎓</div>
            <p className="text-sm">No students found.</p>
          </div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Roll No</th>
                <th className="px-5 py-3 text-left">Class</th>
                <th className="px-5 py-3 text-left">Face Photos</th>
                <th className="px-5 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {students.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{s.name}</td>
                  <td className="px-5 py-3 text-gray-500">{s.roll_number}</td>
                  <td className="px-5 py-3">{s.class_name} / {s.section}</td>
                  <td className="px-5 py-3">
                    <span className={s.face_count > 0 ? 'badge-green' : 'badge-yellow'}>
                      {s.face_count} {s.face_count === 1 ? 'photo' : 'photos'}
                    </span>
                  </td>
                  <td className="px-5 py-3 flex gap-2">
                    <Link to={`/students/${s.id}`} className="btn-secondary btn-sm">View</Link>
                    {isSuperAdmin && (
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(s.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">No students found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
