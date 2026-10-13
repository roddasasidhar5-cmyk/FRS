import { useEffect, useState } from 'react'
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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Faculty Management</h1>
        <button className="btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? '✕ Cancel' : '+ Add Faculty'}
        </button>
      </div>

      {error   && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

      {showForm && (
        <div className="card p-4 sm:p-6 mb-5">
          <h2 className="text-base font-semibold mb-4">Add Faculty Member</h2>
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
              <select className="input" value={form.role}
                onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                <option value="faculty">Faculty</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Face Photo <span className="text-gray-400 font-normal">(for session verification)</span></label>
              <input type="file" accept="image/*" className="input py-1.5 text-sm"
                onChange={e => setFaceFile(e.target.files[0])} />
              <p className="text-xs text-gray-400 mt-1">Upload a clear front-facing photo. Required to take attendance.</p>
            </div>
            <div className="sm:col-span-2 flex gap-2 flex-wrap">
              <button type="submit" className="btn-primary btn-sm" disabled={loading}>
                {loading ? 'Adding…' : 'Add Faculty'}
              </button>
              <button type="button" className="btn-secondary btn-sm"
                onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile: card list */}
      <div className="sm:hidden space-y-2">
        {users.map(u => (
          <div key={u.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm">{u.full_name || u.username}</div>
                <div className="text-xs text-gray-400">@{u.username}</div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <span className={u.role === 'super_admin' ? 'badge-blue' : 'badge-gray'}>
                    {u.role === 'super_admin' ? 'Super Admin' : 'Faculty'}
                  </span>
                  <span className={u.face_enrolled ? 'badge-green' : 'badge-yellow'}>
                    {u.face_enrolled ? '✓ Face enrolled' : '✗ No face'}
                  </span>
                </div>
              </div>
              {u.id !== me?.id && (
                <button className="btn-danger btn-sm flex-shrink-0" onClick={() => handleDelete(u.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No users found.</div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Username</th>
                <th className="px-5 py-3 text-left">Role</th>
                <th className="px-5 py-3 text-left">Face Enrolled</th>
                <th className="px-5 py-3 text-left">Added</th>
                <th className="px-5 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{u.full_name || u.username}</td>
                  <td className="px-5 py-3 text-gray-500">@{u.username}</td>
                  <td className="px-5 py-3">
                    <span className={u.role === 'super_admin' ? 'badge-blue' : 'badge-gray'}>
                      {u.role === 'super_admin' ? 'Super Admin' : 'Faculty'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {u.face_enrolled ? <span className="badge-green">✓ Yes</span> : <span className="badge-yellow">✗ No</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{u.created_at?.split('T')[0]}</td>
                  <td className="px-5 py-3">
                    {u.id !== me?.id && (
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(u.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
