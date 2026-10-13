import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/client'

export default function StudentDetail() {
  const { id } = useParams()
  const [student, setStudent]   = useState(null)
  const [faces, setFaces]       = useState([])
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg]           = useState({ text: '', type: '' })
  const [capturing, setCapturing] = useState(false)
  const [preview, setPreview]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const load = () => {
    api.get(`/students/${id}`).then(r => {
      setStudent(r.data.student); setFaces(r.data.faces)
    }).catch(() => {})
  }
  useEffect(() => { load() }, [id])

  const showMsg = (text, type = 'info') => setMsg({ text, type })

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

  const startCapture = async () => {
    setCapturing(true); setPreview(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      showMsg('Camera access denied: ' + err.message, 'error')
      setCapturing(false)
    }
  }

  const stopCapture = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCapturing(false); setPreview(null)
  }

  const takeSnapshot = () => {
    const v = videoRef.current; const c = canvasRef.current
    if (!v || !c) return
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    setPreview(c.toDataURL('image/jpeg', 0.9))
  }

  const saveCapture = async () => {
    if (!preview) return
    setSaving(true)
    try {
      await api.post(`/students/${id}/faces/save_capture`, { image: preview })
      showMsg('Photo saved successfully.', 'success')
      stopCapture(); load()
    } catch (err) {
      showMsg(err.response?.data?.error || 'Save failed', 'error')
    } finally { setSaving(false) }
  }

  const deleteFace = async faceId => {
    if (!confirm('Remove this photo?')) return
    try { await api.delete(`/students/${id}/faces/${faceId}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  if (!student) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Link to="/students" className="text-blue-600 hover:underline text-sm">← Students</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-lg sm:text-2xl font-bold text-gray-900">{student.name}</h1>
        <span className="badge-gray text-xs">{student.roll_number}</span>
        <span className="badge-blue text-xs">{student.class_name} / {student.section}</span>
      </div>

      {/* Message */}
      {msg.text && (
        <div className={`mb-4 p-3 rounded-lg text-sm border
          ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            msg.type === 'error'   ? 'bg-red-50 border-red-200 text-red-700' :
                                     'bg-blue-50 border-blue-200 text-blue-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Upload + Capture — stacked on mobile, side by side on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">

        {/* Upload */}
        <div className="card p-4 sm:p-5">
          <h2 className="font-semibold mb-1 text-sm sm:text-base">Upload Photos</h2>
          <p className="text-xs text-gray-400 mb-3">Upload 3–5 clear front-facing photos for best accuracy.</p>
          <label className="block cursor-pointer">
            <div className={`border-2 border-dashed rounded-xl p-5 text-center transition
              ${uploading ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-blue-600 text-sm">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" /> Uploading…
                </div>
              ) : (
                <>
                  <div className="text-3xl mb-1.5">📸</div>
                  <div className="text-sm text-gray-600">Tap to upload photos</div>
                  <div className="text-xs text-gray-400">JPG or PNG, multiple files OK</div>
                </>
              )}
            </div>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={handleUpload} disabled={uploading} />
          </label>
        </div>

        {/* Webcam capture */}
        <div className="card p-4 sm:p-5">
          <h2 className="font-semibold mb-1 text-sm sm:text-base">Live Capture</h2>
          <p className="text-xs text-gray-400 mb-3">Use your camera to take a photo directly.</p>
          {!capturing ? (
            <button className="btn-primary btn-sm w-full" onClick={startCapture}>📷 Open Camera</button>
          ) : (
            <div>
              <video ref={videoRef} autoPlay playsInline muted
                className="w-full rounded-lg mb-3 max-h-48 object-cover bg-black" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2 mb-2 flex-wrap">
                <button className="btn-primary btn-sm flex-1" onClick={takeSnapshot}>📸 Snapshot</button>
                <button className="btn-secondary btn-sm flex-1" onClick={stopCapture}>✕ Close</button>
              </div>
              {preview && (
                <div className="mt-2">
                  <img src={preview} alt="Preview"
                    className="w-24 h-24 rounded-lg object-cover border border-gray-200 mb-2" />
                  <div className="flex gap-2">
                    <button className="btn-success btn-sm" onClick={saveCapture} disabled={saving}>
                      {saving ? 'Saving…' : '✓ Save Photo'}
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => setPreview(null)}>Retake</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Enrolled faces grid */}
      <div className="card p-4 sm:p-5">
        <h2 className="font-semibold mb-3 text-sm sm:text-base">
          Enrolled Face Photos
          <span className="ml-2 badge-gray font-normal">{faces.length}</span>
        </h2>
        {faces.length === 0 ? (
          <p className="text-gray-400 text-sm">No photos enrolled yet. Upload or capture above.</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
            {faces.map(f => (
              <div key={f.id} className="relative group">
                <img
                  src={`/${f.image_path}`}
                  alt="Face"
                  className="w-full aspect-square object-cover rounded-lg border border-gray-200"
                />
                <button
                  onClick={() => deleteFace(f.id)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full
                             text-xs opacity-0 group-hover:opacity-100 active:opacity-100
                             transition flex items-center justify-center shadow"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
