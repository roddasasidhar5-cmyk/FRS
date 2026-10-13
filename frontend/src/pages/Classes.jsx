import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Classes() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const [classes, setClasses] = useState([])
  const [form, setForm]       = useState({ name: '', section: '' })
  const [showForm, setShowForm] = useState(false)
  const [error, setError]       = useState('')
  const isSuperAdmin = user?.role === 'super_admin'

  const load = () => api.get('/classes').then(r => setClasses(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleAdd = async e => {
    e.preventDefault(); setError('')
    try {
      await api.post('/classes', form)
      setForm({ name: '', section: '' })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add class')
    }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this class and all its students?')) return
    try { await api.delete(`/classes/${id}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Classes</h1>
        {isSuperAdmin && (
          <button className="btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
            {showForm ? '✕ Cancel' : '+ Add Class'}
          </button>
        )}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {showForm && isSuperAdmin && (
        <div className="card p-4 sm:p-5 mb-5">
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="label">Class Name</label>
              <input className="input" required placeholder="e.g. CSE-A"
                value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div className="flex-1">
              <label className="label">Section / Year</label>
              <input className="input" required placeholder="e.g. 3rd Year"
                value={form.section} onChange={e => setForm(f => ({...f, section: e.target.value}))} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="btn-primary w-full sm:w-auto">Add</button>
            </div>
          </form>
        </div>
      )}

      {/* Class cards — 1 col mobile, 2 tablet, 3 desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map(c => (
          <div key={c.id} className="card p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-gray-900">{c.name}</div>
                <div className="text-sm text-gray-500">{c.section}</div>
              </div>
              <span className="badge-blue flex-shrink-0">{c.student_count} students</span>
            </div>
            <div className="flex gap-2 mt-auto pt-3 border-t border-gray-50">
              <button
                className="btn-primary btn-sm flex-1 text-xs sm:text-sm"
                onClick={() => navigate(`/attendance/session/${c.id}`)}
              >
                📷 Attendance
              </button>
              <button
                className="btn-secondary btn-sm flex-1 text-xs sm:text-sm"
                onClick={() => navigate(`/students?class_id=${c.id}`)}
              >
                👥 Students
              </button>
              {isSuperAdmin && (
                <button className="btn-danger btn-sm px-2.5" onClick={() => handleDelete(c.id)}
                  title="Delete class">🗑</button>
              )}
            </div>
          </div>
        ))}
        {classes.length === 0 && (
          <div className="col-span-full text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🏫</div>
            <p className="text-sm">{isSuperAdmin ? 'No classes yet. Add one above.' : 'No classes yet. Ask your admin.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
