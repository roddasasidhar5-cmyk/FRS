import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import api from '../api/client'

// ── Live camera with flip button (same pattern as StudentDetail) ──────────────
function LiveCapture({ onSave, onClose }) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [facingMode, setFacingMode] = useState('user')
  const [ready,      setReady]      = useState(false)
  const [flipping,   setFlipping]   = useState(false)
  const [preview,    setPreview]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [camError,   setCamError]   = useState(null)
  const [multiCam,   setMultiCam]   = useState(false)
  const [isHttpWarning, setIsHttpWarning] = useState(false)

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then(d => setMultiCam(d.filter(x => x.kind === 'videoinput').length > 1))
      .catch(() => setMultiCam(true))
  }, [])

  useEffect(() => {
    let cancelled = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setReady(false); setCamError(null)

    const isRemoteHttp =
      location.protocol === 'http:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    if (isRemoteHttp) setIsHttpWarning(true)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamError(
        isRemoteHttp
          ? 'Camera blocked: mobile browsers require HTTPS to access the camera over a network.'
          : 'Camera not available on this browser/device.'
      )
      return
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
    })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => { if (!cancelled) { setReady(true); setFlipping(false) } }
          videoRef.current.oncanplay        = () => { if (!cancelled) { setReady(true); setFlipping(false) } }
        }
      })
      .catch(err => {
        if (cancelled) return
        setFlipping(false)
        if (facingMode === 'environment') { setFacingMode('user'); return }
        setCamError(
          err.name === 'NotAllowedError'  ? 'Camera permission denied.' :
          err.name === 'NotFoundError'    ? 'No camera found.' :
          err.name === 'NotReadableError' ? 'Camera in use by another app.' :
                                           `Camera error: ${err.message}`
        )
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [facingMode])

  const handleClose = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    onClose()
  }, [onClose])

  const handleFlip = () => {
    if (flipping) return
    setFlipping(true); setPreview(null)
    setFacingMode(m => m === 'user' ? 'environment' : 'user')
  }

  const takeSnapshot = () => {
    const v = videoRef.current; const c = canvasRef.current
    if (!v || !c) return
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    setPreview(c.toDataURL('image/jpeg', 0.92))
  }

  const handleSave = async () => {
    if (!preview) return
    setSaving(true)
    try { await onSave(preview) } finally { setSaving(false) }
  }

  if (camError) return (
    <div className="rounded-xl bg-gray-900 text-white p-5 text-center space-y-3">
      <svg className="w-8 h-8 text-red-400 mx-auto" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <p className="text-sm text-red-300">{camError}</p>
      {isHttpWarning && (
        <div className="text-xs text-amber-300 bg-amber-900/40 rounded-lg p-3 max-w-xs mx-auto">
          ⚠️ Mobile browsers require <strong>HTTPS</strong> to access the camera from a network address.
          Connect via <strong>https://</strong> or use the upload option instead.
        </div>
      )}
      <div className="flex gap-2 justify-center">
        <button className="btn-secondary btn-sm" onClick={() => { setCamError(null); setFacingMode('user') }}>Retry</button>
        <button className="btn-secondary btn-sm" onClick={handleClose}>Close</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ minHeight: 200 }}>
        <video ref={videoRef} autoPlay playsInline muted
          className="w-full block"
          style={{ maxHeight: 260, objectFit: 'cover',
                   transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                   display: ready ? 'block' : 'none' }} />
        <canvas ref={canvasRef} className="hidden" />
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-white/30 border-t-white" />
            <span className="text-white text-sm">{flipping ? 'Switching…' : 'Starting camera…'}</span>
            {isHttpWarning && (
              <div className="text-xs text-amber-300 bg-amber-900/40 rounded-lg p-3 max-w-xs text-center mx-4">
                ⚠️ Mobile browsers need <strong>HTTPS</strong> to access the camera over a network.
              </div>
            )}
          </div>
        )}
        {ready && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/20 pointer-events-none">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white text-[11px] font-medium">
              {facingMode === 'user' ? 'Front Camera' : 'Back Camera'}
            </span>
          </div>
        )}
        {ready && (multiCam || facingMode === 'environment') && (
          <button onClick={handleFlip} disabled={flipping}
            className={`absolute top-2 right-2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm
                        border border-white/20 flex items-center justify-center text-white
                        transition-all active:scale-95
                        ${flipping ? 'opacity-40 cursor-not-allowed' : 'opacity-90 hover:opacity-100'}`}>
            {flipping
              ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
            }
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary btn-sm flex-1" onClick={takeSnapshot} disabled={!ready}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Take Snapshot
        </button>
        <button className="btn-secondary btn-sm" onClick={handleClose}>Close</button>
      </div>
      {preview && (
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
          <img src={preview} alt="Preview"
            className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 mb-2">Use this photo?</p>
            <div className="flex gap-2">
              <button className="btn-success btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : '✓ Save Photo'}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setPreview(null)}>Retake</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function UserDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()

  const [user,       setUser]       = useState(null)
  const [msg,        setMsg]        = useState({ text: '', type: '' })
  const [saving,     setSaving]     = useState(false)
  const [capturing,  setCapturing]  = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [delFace,    setDelFace]    = useState(false)

  // Edit form state
  const [editMode,   setEditMode]   = useState(false)
  const [form,       setForm]       = useState({
    full_name: '', role: 'faculty', password: '', confirm_password: ''
  })

  const load = () => {
    api.get(`/users/${id}`)
      .then(r => {
        setUser(r.data)
        setForm(f => ({
          ...f,
          full_name: r.data.full_name || '',
          role:      r.data.role,
          password:        '',
          confirm_password: '',
        }))
      })
      .catch(() => navigate('/users'))
  }

  useEffect(() => { load() }, [id])

  const showMsg = (text, type = 'info') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: '' }), 4000)
  }

  // ── Save edits ──────────────────────────────────────────────────────────────
  const handleSaveEdit = async e => {
    e.preventDefault()
    if (form.password && form.password !== form.confirm_password) {
      showMsg('Passwords do not match.', 'error'); return
    }
    setSaving(true)
    try {
      const fd = new FormData()
      if (form.full_name)  fd.append('full_name', form.full_name)
      if (form.role)        fd.append('role',      form.role)
      if (form.password)    fd.append('password',  form.password)
      await api.put(`/users/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showMsg('Details updated successfully.', 'success')
      setEditMode(false); load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Update failed.', 'error')
    } finally { setSaving(false) }
  }

  // ── Upload face photo ───────────────────────────────────────────────────────
  const handleUploadFace = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('face_image', file)
      await api.put(`/users/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showMsg('Face photo updated.', 'success'); load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Upload failed.', 'error')
    } finally { setUploading(false) }
  }

  // ── Capture face live ───────────────────────────────────────────────────────
  const handleSaveCapturedFace = async (b64) => {
    // Convert base64 dataURL → File object
    const res  = await fetch(b64)
    const blob = await res.blob()
    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' })
    const fd   = new FormData()
    fd.append('face_image', file)
    await api.put(`/users/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    showMsg('Face photo saved.', 'success')
    setCapturing(false); load()
  }

  // ── Remove face ─────────────────────────────────────────────────────────────
  const handleRemoveFace = async () => {
    if (!confirm('Remove this face photo? The faculty won\'t be able to start attendance sessions.')) return
    setDelFace(true)
    try {
      const fd = new FormData()
      fd.append('remove_face', '1')
      await api.put(`/users/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showMsg('Face photo removed.', 'success'); load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed.', 'error')
    } finally { setDelFace(false) }
  }

  if (!user) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-200 border-t-brand-600" />
    </div>
  )

  const initials = (user.full_name || user.username || '?')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="space-y-6 animate-slide-up">

      {/* ── Breadcrumb + header ── */}
      <div>
        <Link to="/users"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 transition mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Faculty
        </Link>

        <div className="flex flex-wrap items-center gap-4">
          {/* Avatar — shows enrolled face if available */}
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 border border-gray-200 shadow-sm">
            {user.face_image_path ? (
              <img src={`/${user.face_image_path}`} alt={user.full_name}
                className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center">
                <span className="text-brand-700 font-bold text-lg">{initials}</span>
              </div>
            )}
          </div>

          <div>
            <h1 className="page-title">{user.full_name || user.username}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-gray-400 text-sm">@{user.username}</span>
              <span className={user.role === 'super_admin' ? 'badge-blue' : 'badge-gray'}>
                {user.role === 'super_admin' ? 'Super Admin' : 'Faculty'}
              </span>
              <span className={user.face_enrolled ? 'badge-green' : 'badge-yellow'}>
                {user.face_enrolled ? '✓ Face enrolled' : '⚠ No face photo'}
              </span>
            </div>
          </div>

          <button
            className={`ml-auto ${editMode ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => setEditMode(m => !m)}>
            {editMode ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel Edit
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Details
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Message ── */}
      {msg.text && (
        <div className={`flex items-center gap-2.5 animate-slide-up
          ${msg.type === 'success' ? 'alert-success' :
            msg.type === 'error'   ? 'alert-error'   : 'alert-info'}`}>
          {msg.type === 'success' && (
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd" />
            </svg>
          )}
          {msg.text}
        </div>
      )}

      {/* ── Edit form ── */}
      {editMode && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/20 animate-slide-up">
          <h2 className="font-semibold text-gray-900 mb-4">Edit Details</h2>
          <form onSubmit={handleSaveEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" placeholder="Dr. Jane Smith"
                value={form.full_name}
                onChange={e => setForm(f => ({...f, full_name: e.target.value}))} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input select" value={form.role}
                onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                <option value="faculty">Faculty</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div>
              <label className="label">New Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></label>
              <input className="input" type="password" placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({...f, password: e.target.value}))} />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input className="input" type="password" placeholder="••••••••"
                value={form.confirm_password}
                disabled={!form.password}
                onChange={e => setForm(f => ({...f, confirm_password: e.target.value}))} />
              {form.password && form.confirm_password && form.password !== form.confirm_password && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Saving…
                  </span>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Save Changes
                  </>
                )}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditMode(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Face enrollment section ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Current face photo */}
        <div className="card p-5">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <h2 className="font-semibold text-gray-900">Face Photo</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-[2.75rem]">
            Used for identity verification before attendance sessions. Must be a clear, front-facing photo.
          </p>

          {user.face_image_path ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <img src={`/${user.face_image_path}`} alt="Face"
                  className="w-24 h-24 rounded-2xl object-cover border-2 border-emerald-200 flex-shrink-0" />
                <div>
                  <div className="badge-green mb-2">✓ Face enrolled</div>
                  <p className="text-xs text-gray-500">
                    This faculty member can start attendance sessions.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {uploading ? 'Uploading…' : 'Replace Photo'}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={handleUploadFace} disabled={uploading} />
                </label>
                <button
                  className="btn-sm text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition"
                  onClick={handleRemoveFace} disabled={delFace}>
                  {delFace ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border-2 border-dashed border-amber-200 bg-amber-50 rounded-xl p-4 text-center">
                <div className="text-2xl mb-1">⚠️</div>
                <p className="text-sm font-medium text-amber-700">No face photo enrolled</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  This faculty member cannot start attendance sessions until a photo is added.
                </p>
              </div>
              <label className="btn-primary w-full cursor-pointer justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {uploading ? 'Uploading…' : 'Upload Face Photo'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={handleUploadFace} disabled={uploading} />
              </label>
            </div>
          )}
        </div>

        {/* Live camera capture */}
        <div className="card p-5">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="font-semibold text-gray-900">Live Capture</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-[2.75rem]">
            Take a photo using the camera directly.{' '}
            <span className="text-brand-500 font-medium">Flip button available on mobile.</span>
          </p>

          {!capturing ? (
            <button className="btn-primary w-full" onClick={() => setCapturing(true)}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Open Camera
            </button>
          ) : (
            <LiveCapture
              onSave={handleSaveCapturedFace}
              onClose={() => setCapturing(false)}
            />
          )}
        </div>
      </div>

      {/* ── Profile info card ── */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Profile Information</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {[
            { label: 'Full Name',   value: user.full_name  || '—' },
            { label: 'Username',    value: `@${user.username}` },
            { label: 'Role',        value: user.role === 'super_admin' ? 'Super Admin' : 'Faculty' },
            { label: 'Joined',      value: user.created_at?.split('T')[0] || '—' },
            { label: 'Face Status', value: user.face_enrolled ? '✓ Enrolled' : 'Not enrolled' },
          ].map(item => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">{item.label}</dt>
              <dd className="text-gray-900 font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

    </div>
  )
}
