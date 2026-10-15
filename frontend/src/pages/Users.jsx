import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Users() {
  const { user: me } = useAuth()
  const [users, setUsers]       = useState([])
  const [form, setForm]         = useState({ username: '', full_name: '', password: '', role: 'faculty' })
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')
  const [showForm, setShowForm] = useState(false)
  const [faceFile, setFaceFile] = useState(null)
  const [loading, setLoading]   = useState(false)

  const load = () => api.get('/users').then(r => setUsers(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleAdd = async e => {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      if (faceFile) fd.append('face_image', faceFile)
      await api.post('/users', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setSuccess('Faculty member added successfully.')
      setForm({ username: '', full_name: '', password: '', role: 'faculty' })
      setFaceFile(null); setShowForm(false); load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add user')
    } finally { setLoading(false) }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this faculty member?')) return
    try { await api.delete(`/users/${id}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  const roleLabel = role => role === 'super_admin' ? 'Super Admin' : 'Faculty'

  return (
    <div className="space-y-6 animate-slide-up">

      <div className="page-header">
        <div>
          <h1 className="page-title">Faculty Management</h1>
          <p className="text-gray-500 text-sm mt-1">{users.length} member{users.length !== 1 ? 's' : ''}</p>
        </div>
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
              Add Faculty
            </>
          )}
        </button>
      </div>

      {error   && <div className="alert-error">{error}</div>}
      {success && <div className="alert-success">{success}</div>}

      {showForm && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/30 animate-slide-up">
          <h2 className="font-semibold text-gray-900 mb-4">New Faculty Member</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" required placeholder="Dr. Jane Smith"
                value={form.full_name} onChange={e => setForm(f => ({...f, full_name: e.target.value}))} />
            </div>
            <div>
              <label className="label">Username</label>
              <input className="input" required placeholder="janesmith"
                value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" required placeholder="••••••••"
                value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input select" value={form.role}
                onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                <option value="faculty">Faculty</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">
                Face Photo
                <span className="text-gray-400 font-normal ml-1">(required for attendance sessions)</span>
              </label>
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className={`border-2 border-dashed rounded-xl px-4 py-3 text-center transition-all
                    ${faceFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/50'}`}>
                    {faceFile ? (
                      <span className="text-sm text-emerald-700 font-medium">✓ {faceFile.name}</span>
                    ) : (
                      <span className="text-sm text-gray-500">Click to upload face photo</span>
                    )}
                  </div>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => setFaceFile(e.target.files[0])} />
                </label>
              </div>
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Adding…
                  </span>
                ) : 'Add Faculty'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {users.map(u => (
          <div key={u.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-brand-700 font-bold text-sm">
                    {(u.full_name || u.username)[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900">{u.full_name || u.username}</div>
                  <div className="text-xs text-gray-400">@{u.username}</div>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className={u.role === 'super_admin' ? 'badge-blue' : 'badge-gray'}>
                      {roleLabel(u.role)}
                    </span>
                    <span className={u.face_enrolled ? 'badge-green' : 'badge-yellow'}>
                      {u.face_enrolled ? '✓ Face enrolled' : 'No face photo'}
                    </span>
                  </div>
                </div>
              </div>
              {u.id !== me?.id && (
                <div className="flex gap-2 flex-shrink-0">
                  <Link to={`/users/${u.id}`}
                    className="flex-shrink-0 btn-secondary btn-sm">
                    View
                  </Link>
                  <button
                    className="flex-shrink-0 btn-sm text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition"
                    onClick={() => handleDelete(u.id)}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="font-medium text-gray-500">No faculty members</p>
          </div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Member</th>
                <th>Username</th>
                <th>Role</th>
                <th>Face Enrolled</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-brand-700 font-bold text-xs">
                          {(u.full_name || u.username)[0].toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-gray-900">{u.full_name || u.username}</span>
                      {u.id === me?.id && <span className="badge-gray text-[10px]">You</span>}
                    </div>
                  </td>
                  <td className="text-gray-500">@{u.username}</td>
                  <td>
                    <span className={u.role === 'super_admin' ? 'badge-blue' : 'badge-gray'}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td>
                    {u.face_enrolled
                      ? <span className="badge-green">✓ Enrolled</span>
                      : <span className="badge-yellow">Not enrolled</span>}
                  </td>
                  <td className="text-gray-400 text-xs">{u.created_at?.split('T')[0]}</td>
                  <td>
                    {u.id !== me?.id ? (
                      <div className="flex items-center gap-2">
                        <Link to={`/users/${u.id}`} className="btn-secondary btn-sm">View</Link>
                        <button
                          className="btn-sm text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition"
                          onClick={() => handleDelete(u.id)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-gray-400">No faculty members found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
