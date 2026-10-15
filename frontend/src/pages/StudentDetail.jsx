import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/client'

// ── Donut ring ────────────────────────────────────────────────────────────────
function PctRing({ pct }) {
  const R  = 28
  const C  = 2 * Math.PI * R
  const fill = pct !== null ? Math.min(Math.max(pct, 0), 100) / 100 : 0
  const dash = C * fill
  const color =
    pct === null ? '#d1d5db' :
    pct >= 75   ? '#10b981' :
    pct >= 65   ? '#f59e0b' : '#ef4444'
  const label =
    pct === null ? 'No Data' :
    pct >= 75   ? 'Good'    :
    pct >= 65   ? 'Low'     : 'Critical'

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={R} fill="none" stroke="#f3f4f6" strokeWidth="7" />
          <circle cx="36" cy="36" r={R} fill="none"
            stroke={color} strokeWidth="7"
            strokeDasharray={`${dash} ${C}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>
            {pct !== null ? `${pct}%` : '—'}
          </span>
        </div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

// ── Live camera with flip button ──────────────────────────────────────────────
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

  // Detect multiple cameras once
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then(d => setMultiCam(d.filter(x => x.kind === 'videoinput').length > 1))
      .catch(() => setMultiCam(true))
  }, [])

  // Start/restart stream whenever facingMode changes
  useEffect(() => {
    let cancelled = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setReady(false); setCamError(null)

    // Check if we're on HTTP from a remote address (camera blocked on mobile)
    const isRemoteHttp =
      location.protocol === 'http:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    if (isRemoteHttp) setIsHttpWarning(true)

    // Camera API not available (HTTP on mobile blocks mediaDevices entirely)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamError(
        isRemoteHttp
          ? 'Camera blocked: mobile browsers require HTTPS to access the camera over a network. Ask your admin to enable HTTPS.'
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
          err.name === 'NotAllowedError'  ? 'Camera permission denied. Allow access and retry.' :
          err.name === 'NotFoundError'    ? 'No camera found on this device.' :
          err.name === 'NotReadableError' ? 'Camera is in use by another app.' :
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
    streamRef.current = null
    onClose()
  }, [onClose])

  const handleFlip = () => {
    if (flipping) return
    setFlipping(true)
    setPreview(null)
    setFacingMode(m => m === 'user' ? 'environment' : 'user')
  }

  const takeSnapshot = () => {
    const v = videoRef.current; const c = canvasRef.current
    if (!v || !c) return
    c.width = v.videoWidth; c.height = v.videoHeight
    // Draw WITHOUT mirror transform — server needs real pixels
    c.getContext('2d').drawImage(v, 0, 0)
    setPreview(c.toDataURL('image/jpeg', 0.9))
  }

  const handleSave = async () => {
    if (!preview) return
    setSaving(true)
    try {
      await onSave(preview)
      setPreview(null)
    } finally { setSaving(false) }
  }

  if (camError) return (
    <div className="rounded-xl bg-gray-900 text-white p-6 text-center space-y-3">
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
      {/* Camera viewport */}
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ minHeight: 200 }}>
        <video
          ref={videoRef} autoPlay playsInline muted
          className="w-full block"
          style={{
            maxHeight: 280,
            objectFit: 'cover',
            // Mirror front camera for natural selfie view; rear is straight
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            display: ready ? 'block' : 'none',
          }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Loading overlay */}
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-white/30 border-t-white" />
            <span className="text-white text-sm">
              {flipping ? 'Switching camera…' : 'Starting camera…'}
            </span>
            {isHttpWarning && (
              <div className="text-xs text-amber-300 bg-amber-900/40 rounded-lg p-3 max-w-xs text-center mx-4">
                ⚠️ Mobile browsers need <strong>HTTPS</strong> to access the camera over a network.
              </div>
            )}
          </div>
        )}

        {/* Camera label badge — top left */}
        {ready && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5
                          bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1
                          border border-white/20 pointer-events-none">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white text-[11px] font-medium">
              {facingMode === 'user' ? 'Front Camera' : 'Back Camera'}
            </span>
          </div>
        )}

        {/* Flip button — top right */}
        {ready && (multiCam || facingMode === 'environment') && (
          <button
            onClick={handleFlip}
            disabled={flipping}
            title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
            className={`absolute top-2 right-2 w-9 h-9 rounded-full
                        bg-black/50 backdrop-blur-sm border border-white/20
                        flex items-center justify-center text-white
                        transition-all duration-150 active:scale-95
                        ${flipping ? 'opacity-40 cursor-not-allowed' : 'opacity-90 hover:opacity-100 hover:bg-black/70'}`}
          >
            {flipping ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button className="btn-primary btn-sm flex-1" onClick={takeSnapshot} disabled={!ready}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Take Snapshot
        </button>
        <button className="btn-secondary btn-sm" onClick={handleClose}>Close</button>
      </div>

      {/* Preview + save */}
      {preview && (
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
          <img src={preview} alt="Preview"
            className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 mb-2">Looks good?</p>
            <div className="flex gap-2">
              <button className="btn-success btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving…
                  </span>
                ) : '✓ Save Photo'}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setPreview(null)}>Retake</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentDetail() {
  const { id } = useParams()
  const [student, setStudent]     = useState(null)
  const [faces, setFaces]         = useState([])
  const [pctData, setPctData]     = useState(null)
  const [classes, setClasses]     = useState([])
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg]             = useState({ text: '', type: '' })
  const [capturing, setCapturing] = useState(false)

  // Edit state
  const [editMode, setEditMode]   = useState(false)
  const [editForm, setEditForm]   = useState({ name: '', roll_number: '', class_id: '' })
  const [saving,   setSaving]     = useState(false)

  const load = () => {
    api.get(`/students/${id}`).then(r => {
      setStudent(r.data.student)
      setFaces(r.data.faces)
      setEditForm({
        name:        r.data.student.name        || '',
        roll_number: r.data.student.roll_number || '',
        class_id:    String(r.data.student.class_id || ''),
      })
    }).catch(() => {})
    api.get(`/attendance/percentage?student_id=${id}`)
      .then(r => setPctData(r.data.students?.[0] ?? null))
      .catch(() => {})
  }
  useEffect(() => { load() }, [id])
  useEffect(() => {
    api.get('/classes').then(r => setClasses(r.data)).catch(() => {})
  }, [])

  const showMsg = (text, type = 'info') => {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: '' }), 4000)
  }

  // ── Save edits ──────────────────────────────────────────────────────────────
  const handleSaveEdit = async e => {
    e.preventDefault()
    if (!editForm.name.trim())        { showMsg('Name cannot be empty.',        'error'); return }
    if (!editForm.roll_number.trim()) { showMsg('Roll number cannot be empty.', 'error'); return }
    if (!editForm.class_id)           { showMsg('Please select a class.',        'error'); return }
    setSaving(true)
    try {
      await api.put(`/students/${id}`, {
        name:        editForm.name.trim(),
        roll_number: editForm.roll_number.trim(),
        class_id:    Number(editForm.class_id),
      })
      showMsg('Student details updated successfully.', 'success')
      setEditMode(false)
      load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Update failed.', 'error')
    } finally { setSaving(false) }
  }

  // ── Upload face photos ───────────────────────────────────────────────────────
  const handleUpload = async e => {
    const files = e.target.files
    if (!files.length) return
    setUploading(true); setMsg({ text: '', type: '' })
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('images', f))
    try {
      await api.post(`/students/${id}/faces/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showMsg('Photos uploaded successfully.', 'success'); load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Upload failed', 'error')
    } finally { setUploading(false) }
  }

  // Called by LiveCapture with the base64 image string
  const handleSaveCapture = async (imageB64) => {
    try {
      await api.post(`/students/${id}/faces/save_capture`, { image: imageB64 })
      showMsg('Photo saved successfully.', 'success')
      load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Save failed', 'error')
      throw err   // let LiveCapture know it failed
    }
  }

  const deleteFace = async faceId => {
    if (!confirm('Remove this photo?')) return
    try { await api.delete(`/students/${id}/faces/${faceId}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  if (!student) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-200 border-t-brand-600" />
    </div>
  )

  return (
    <div className="space-y-6 animate-slide-up">

      {/* Breadcrumb + header */}
      <div>
        <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 transition mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Students
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
            <span className="text-brand-700 font-bold text-lg">{student.name[0].toUpperCase()}</span>
          </div>
          <div>
            <h1 className="page-title">{student.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="badge-gray font-mono">{student.roll_number}</span>
              <span className="badge-blue">{student.class_name} / {student.section}</span>
              <span className={faces.length > 0 ? 'badge-green' : 'badge-yellow'}>
                {faces.length} face photo{faces.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          {/* Edit button */}
          <button
            className={`ml-auto ${editMode ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => setEditMode(m => !m)}>
            {editMode ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
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

      {/* Message */}
      {msg.text && (
        <div className={`
          flex items-center gap-2.5 animate-slide-up
          ${msg.type === 'success' ? 'alert-success' :
            msg.type === 'error'   ? 'alert-error'   : 'alert-info'}
        `}>
          {msg.type === 'success' && (
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
          {msg.text}
        </div>
      )}

      {/* ── Edit form ── */}
      {editMode && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/20 animate-slide-up">
          <h2 className="font-semibold text-gray-900 mb-4">Edit Student Details</h2>
          <form onSubmit={handleSaveEdit} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Full Name <span className="text-red-400">*</span></label>
              <input
                className="input"
                required
                placeholder="Student full name"
                value={editForm.name}
                onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Roll Number <span className="text-red-400">*</span></label>
              <input
                className="input font-mono"
                required
                placeholder="e.g. 242UA05301"
                value={editForm.roll_number}
                onChange={e => setEditForm(f => ({...f, roll_number: e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Class <span className="text-red-400">*</span></label>
              <select
                className="input select"
                required
                value={editForm.class_id}
                onChange={e => setEditForm(f => ({...f, class_id: e.target.value}))}
              >
                <option value="">Select class</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name} / {c.section}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 flex gap-2 pt-1">
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
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  // Reset form to current student values
                  setEditForm({
                    name:        student.name,
                    roll_number: student.roll_number,
                    class_id:    String(student.class_id),
                  })
                  setEditMode(false)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Attendance percentage card */}
      {pctData && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Attendance Overview</h2>
          <div className="flex flex-wrap items-center gap-6">
            <PctRing pct={pctData.percentage} />
            <div className="flex flex-wrap gap-4 flex-1">
              {[
                { label: 'Sessions Held',    value: pctData.total_sessions, color: 'text-gray-900' },
                { label: 'Sessions Attended', value: pctData.attended,       color: 'text-emerald-600' },
                { label: 'Sessions Missed',   value: pctData.total_sessions - pctData.attended, color: 'text-red-500' },
              ].map(stat => (
                <div key={stat.label} className="bg-gray-50 rounded-xl px-4 py-3 min-w-[110px]">
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
                </div>
              ))}
              {pctData.percentage !== null && pctData.percentage < 75 && (
                <div className={`rounded-xl px-4 py-3 min-w-[140px] flex-1 ${
                  pctData.percentage < 65 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <div className={`text-sm font-bold ${pctData.percentage < 65 ? 'text-red-700' : 'text-amber-700'}`}>
                    {pctData.percentage < 65 ? '⚠️ Critical' : '⚠️ Below Minimum'}
                  </div>
                  <div className={`text-xs mt-1 ${pctData.percentage < 65 ? 'text-red-600' : 'text-amber-600'}`}>
                    Needs {Math.ceil(
                      Math.max(0, (0.75 * pctData.total_sessions - pctData.attended) / 0.25)
                    )} more consecutive sessions to reach 75%
                  </div>
                </div>
              )}
              {pctData.percentage !== null && pctData.percentage >= 75 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 min-w-[140px] flex-1">
                  <div className="text-sm font-bold text-emerald-700">✓ Eligible</div>
                  <div className="text-xs text-emerald-600 mt-1">
                    Can miss {Math.floor(
                      pctData.total_sessions * 0.25 - (pctData.total_sessions - pctData.attended)
                    )} more session{Math.floor(pctData.total_sessions * 0.25 - (pctData.total_sessions - pctData.attended)) !== 1 ? 's' : ''} and stay ≥ 75%
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload + Capture */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Upload */}
        <div className="card p-5">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h2 className="font-semibold text-gray-900">Upload Photos</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-[2.75rem]">Upload 3–5 clear front-facing photos for best recognition accuracy.</p>
          <label className="block cursor-pointer">
            <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-150
              ${uploading
                ? 'border-brand-300 bg-brand-50'
                : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/50'}`}>
              {uploading ? (
                <div className="flex flex-col items-center gap-2 text-brand-600">
                  <svg className="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm font-medium">Uploading…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Click to upload photos</div>
                    <div className="text-xs text-gray-400">JPG or PNG · Multiple files OK</div>
                  </div>
                </div>
              )}
            </div>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={handleUpload} disabled={uploading} />
          </label>
        </div>

        {/* Live Capture */}
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
            Use your camera to take a photo directly.
            {' '}<span className="text-brand-500 font-medium">Flip button available on mobile.</span>
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
              onSave={handleSaveCapture}
              onClose={() => setCapturing(false)}
            />
          )}
        </div>
      </div>

      {/* Enrolled faces grid */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">
            Enrolled Face Photos
          </h2>
          <span className={faces.length > 0 ? 'badge-green' : 'badge-yellow'}>
            {faces.length} enrolled
          </span>
        </div>
        {faces.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-gray-300 gap-2">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <p className="text-sm text-gray-400">No photos enrolled yet. Upload or capture above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2.5">
            {faces.map(f => (
              <div key={f.id} className="relative group">
                <img
                  src={`/${f.image_path}`}
                  alt="Face"
                  className="w-full aspect-square object-cover rounded-xl border border-gray-200
                             group-hover:border-brand-300 transition-all duration-150"
                />
                <button
                  onClick={() => deleteFace(f.id)}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full
                             text-xs opacity-0 group-hover:opacity-100 transition-all duration-150
                             flex items-center justify-center shadow-sm hover:bg-red-600"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
