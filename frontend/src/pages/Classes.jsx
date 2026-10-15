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
  const [error, setError]     = useState('')
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
    <div className="space-y-6 animate-slide-up">

      <div className="page-header">
        <div>
          <h1 className="page-title">Classes</h1>
          <p className="text-gray-500 text-sm mt-1">{classes.length} class{classes.length !== 1 ? 'es' : ''} registered</p>
        </div>
        {isSuperAdmin && (
          <button className={showForm ? 'btn-secondary' : 'btn-primary'} onClick={() => setShowForm(s => !s)}>
            {showForm ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Class
              </>
            )}
          </button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && isSuperAdmin && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/30 animate-slide-up">
          <h2 className="font-semibold text-gray-900 mb-4">New Class</h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="label">Class Name</label>
              <input className="input" required placeholder="e.g. Computer Science"
                value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div className="flex-1">
              <label className="label">Section / Year</label>
              <input className="input" required placeholder="e.g. 3rd Year / Section A"
                value={form.section} onChange={e => setForm(f => ({...f, section: e.target.value}))} />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">Add Class</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map(c => (
          <div key={c.id} className="card-hover p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{c.name}</div>
                  <div className="text-sm text-gray-500">{c.section}</div>
                </div>
              </div>
              <span className="badge-blue flex-shrink-0">{c.student_count} students</span>
            </div>

            <div className="flex gap-2 pt-3 border-t border-gray-100">
              <button
                className="btn-primary btn-sm flex-1"
                onClick={() => navigate(`/attendance/session/${c.id}`)}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Attendance
              </button>
              <button
                className="btn-secondary btn-sm flex-1"
                onClick={() => navigate(`/students?class_id=${c.id}`)}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Students
              </button>
              {isSuperAdmin && (
                <button
                  className="btn-secondary btn-sm px-2.5 text-red-500 hover:bg-red-50 hover:border-red-200"
                  onClick={() => handleDelete(c.id)}
                  title="Delete class"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}

        {classes.length === 0 && (
          <div className="col-span-full empty-state">
            <div className="empty-state-icon">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <p className="font-medium text-gray-500">No classes yet</p>
            <p className="text-sm text-gray-400 mt-1">
              {isSuperAdmin ? 'Click "Add Class" to create one.' : 'Ask your admin to create a class.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
