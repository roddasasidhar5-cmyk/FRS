import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/client'
import CameraView from '../components/CameraView'

const PHASE = { IDLE: 'idle', VERIFY_FACULTY: 'verify_faculty', ACTIVE: 'active', DONE: 'done' }

export default function AttendanceSession() {
  const { classId } = useParams()
  const navigate    = useNavigate()

  const [cls, setCls]             = useState(null)
  const [phase, setPhase]         = useState(PHASE.IDLE)
  const [faces, setFaces]         = useState([])
  const [present, setPresent]     = useState([])
  const [statusMsg, setStatusMsg] = useState('')
  const [stopping, setStopping]   = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    api.get(`/classes/${classId}`).then(r => setCls(r.data)).catch(() => {})
  }, [classId])

  // Poll present list while session active
  useEffect(() => {
    if (phase === PHASE.ACTIVE) {
      pollRef.current = setInterval(() => {
        api.get(`/attendance/status/${classId}`)
          .then(r => setPresent(r.data.present || []))
          .catch(() => {})
      }, 2000)
    }
    return () => clearInterval(pollRef.current)
  }, [phase, classId])

  const startSession = async () => {
    try {
      await api.post('/attendance/sessions', { class_id: Number(classId) })
      setPhase(PHASE.VERIFY_FACULTY)
      setStatusMsg('Look at the camera and blink to verify your identity.')
    } catch (err) {
      alert(err.response?.data?.error || 'Could not start session')
    }
  }

  const stopSession = async () => {
    setStopping(true)
    try {
      await api.post(`/attendance/sessions/${classId}/stop`)
      clearInterval(pollRef.current)
      setPhase(PHASE.DONE)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to stop')
    } finally { setStopping(false) }
  }

  const handleFrame = useCallback(async b64 => {
    if (phase !== PHASE.VERIFY_FACULTY && phase !== PHASE.ACTIVE) return
    try {
      const r = await api.post('/recognize', {
        image: b64,
        class_id: Number(classId),
        mode: phase === PHASE.VERIFY_FACULTY ? 'faculty' : 'students',
      })
      setFaces(r.data.faces || [])

      if (phase === PHASE.VERIFY_FACULTY) {
        const ok = r.data.faces?.find(f => f.decision === 'FACULTY_VERIFIED')
        if (ok) {
          setPhase(PHASE.ACTIVE)
          setStatusMsg(`✅ Verified: ${ok.name}. Session active — students can now be recognised.`)
        } else {
          const f = r.data.faces?.[0]
          setStatusMsg(
            !f             ? 'No face detected. Look straight at the camera.' :
            f.decision === 'SPOOF'   ? 'Face detected — blink to confirm liveness.' :
            f.decision === 'DENIED'  ? 'Face not recognised. Ensure your face photo is enrolled.' :
                                       'Verifying…'
          )
        }
      } else {
        const granted = r.data.faces?.filter(f => f.decision === 'GRANTED') || []
        setStatusMsg(
          granted.length  ? `Recognised: ${granted.map(f => f.name).join(', ')}` :
          r.data.faces?.length ? (
            r.data.faces[0].decision === 'SPOOF' ? 'Blink to confirm liveness' : 'Scanning…'
          ) : 'No faces detected'
        )
      }
    } catch { /* ignore transient network errors */ }
  }, [phase, classId])

  const decisionColor = d => ({
    GRANTED:          'text-green-600',
    FACULTY_VERIFIED: 'text-blue-600',
    SPOOF:            'text-yellow-600',
    DENIED:           'text-red-500',
  }[d] || 'text-gray-400')

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Attendance Session</h1>
          {cls && <p className="text-gray-500 text-sm mt-0.5">{cls.name} / {cls.section}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {phase === PHASE.IDLE && (
            <button className="btn-primary btn-sm" onClick={startSession}>📷 Start Session</button>
          )}
          {(phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE) && (
            <button className="btn-danger btn-sm" onClick={stopSession} disabled={stopping}>
              {stopping ? 'Stopping…' : '⏹ Stop Session'}
            </button>
          )}
          {phase === PHASE.DONE && (
            <button className="btn-secondary btn-sm" onClick={() => navigate('/reports')}>
              View Report →
            </button>
          )}
        </div>
      </div>

      {/* Phase status banner */}
      {phase !== PHASE.IDLE && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium
          ${phase === PHASE.VERIFY_FACULTY ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' : ''}
          ${phase === PHASE.ACTIVE         ? 'bg-green-50  text-green-800  border border-green-200'  : ''}
          ${phase === PHASE.DONE           ? 'bg-gray-50   text-gray-700   border border-gray-200'   : ''}`}>
          {phase === PHASE.VERIFY_FACULTY && '🔐 '}
          {phase === PHASE.ACTIVE         && '✅ '}
          {phase === PHASE.DONE           && '🏁 '}
          {statusMsg}
        </div>
      )}

      {/* Idle state */}
      {phase === PHASE.IDLE && (
        <div className="card p-8 sm:p-12 text-center max-w-lg mx-auto">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-700 mb-2">
            Ready to take attendance?
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            First verify your identity, then the camera will recognise students.
            Multiple faces can be recognised simultaneously.
          </p>
          <button className="btn-primary" onClick={startSession}>Start Attendance Session</button>
        </div>
      )}

      {/* Done state */}
      {phase === PHASE.DONE && (
        <div className="card p-8 sm:p-12 text-center max-w-lg mx-auto">
          <div className="text-5xl mb-4">🏁</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Session Ended</h2>
          <p className="text-gray-400 text-sm mb-4">{present.length} student(s) marked present.</p>
          <button className="btn-primary" onClick={() => navigate('/reports')}>View Full Report</button>
        </div>
      )}

      {/* Active/verifying */}
      {(phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE) && (
        <div className="flex flex-col lg:flex-row gap-4">

          {/* Camera panel */}
          <div className="flex-1 min-w-0 space-y-3">
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium text-sm text-gray-700">
                  {phase === PHASE.VERIFY_FACULTY ? '🔐 Faculty Verification' : '📷 Live Recognition'}
                </span>
                {faces.length > 0 && (
                  <div className="flex gap-3 flex-wrap">
                    {faces.map((f, i) => (
                      <span key={i} className={`text-xs font-semibold ${decisionColor(f.decision)}`}>
                        {f.name} — {f.decision}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <CameraView
                onFrame={handleFrame}
                faces={faces}
                intervalMs={500}
                active={phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE}
              />
            </div>

            {/* Face results strip */}
            {faces.length > 0 && (
              <div className="card p-3 sm:p-4">
                <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide font-medium">Current Frame</p>
                <div className="flex flex-wrap gap-2">
                  {faces.map((f, i) => (
                    <div key={i} className={`px-3 py-1.5 rounded-full text-xs font-semibold border
                      ${f.decision === 'GRANTED' || f.decision === 'FACULTY_VERIFIED'
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : f.decision === 'SPOOF'
                        ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                        : 'bg-red-50 border-red-200 text-red-600'}`}>
                      {f.name || 'Unknown'} · {f.decision}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Present list */}
          <div className="w-full lg:w-64 xl:w-72 flex-shrink-0">
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="font-medium text-sm text-gray-700">Present Today</span>
                <span className="badge-green">{present.length}</span>
              </div>
              <div className="max-h-96 lg:max-h-[calc(100vh-280px)] overflow-auto">
                {present.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                    <div className="text-3xl mb-2">⏳</div>
                    <div className="text-xs">Waiting for recognitions…</div>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {present.map(s => (
                      <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <div className="font-medium text-sm">{s.name}</div>
                          <div className="text-xs text-gray-400">{s.roll_number}</div>
                        </div>
                        <span className="badge-green text-xs">{s.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
