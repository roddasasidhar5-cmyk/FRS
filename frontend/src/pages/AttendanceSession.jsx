import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/client'
import CameraView from '../components/CameraView'

const PHASE = {
  LOADING:        'loading',        // fetching today's state from server
  IDLE:           'idle',           // not started yet, no data for today
  VERIFY_FACULTY: 'verify_faculty', // need face verification first
  ACTIVE:         'active',         // session running, marking students
  DONE:           'done',           // session stopped
}

export default function AttendanceSession() {
  const { classId } = useParams()
  const navigate    = useNavigate()
  const cid         = Number(classId)

  const [cls, setCls]             = useState(null)
  const [phase, setPhase]         = useState(PHASE.LOADING)
  const [faces, setFaces]         = useState([])
  const [present, setPresent]     = useState([])   // [{id,name,roll_number,time}]
  const [total, setTotal]         = useState(0)    // total enrolled students
  const [statusMsg, setStatusMsg] = useState('')
  const [stopping, setStopping]   = useState(false)
  const [resuming, setResuming]   = useState(false) // true when re-entering mid-session
  const pollRef    = useRef(null)
  const inFlightRef = useRef(false)   // prevent frame queue pileup

  // ── Load class info ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/classes/${cid}`).then(r => setCls(r.data)).catch(() => {})
  }, [cid])

  // ── On mount: check today's state so we can resume if needed ────────────────
  useEffect(() => {
    api.get(`/attendance/sessions/${cid}/state`)
      .then(r => {
        const d = r.data
        setTotal(d.total_students)

        if (d.present.length > 0 || d.faculty_verified) {
          // There's already activity today — offer resume
          setPresent(d.present)
          setResuming(true)
          setPhase(PHASE.IDLE)
        } else {
          setPhase(PHASE.IDLE)
        }
      })
      .catch(() => setPhase(PHASE.IDLE))
  }, [cid])

  // ── Poll present list while session active ──────────────────────────────────
  useEffect(() => {
    if (phase === PHASE.ACTIVE) {
      pollRef.current = setInterval(() => {
        api.get(`/attendance/status/${cid}`)
          .then(r => {
            setPresent(r.data.present || [])
            setTotal(r.data.total || total)
          })
          .catch(() => {})
      }, 2000)
    }
    return () => clearInterval(pollRef.current)
  }, [phase, cid])

  // ── Start / resume session ──────────────────────────────────────────────────
  const startSession = async () => {
    try {
      const r = await api.post('/attendance/sessions', { class_id: cid })
      const d = r.data

      // Load already-present from server right away
      const statusR = await api.get(`/attendance/status/${cid}`)
      setPresent(statusR.data.present || [])
      setTotal(statusR.data.total || d.students?.length || 0)

      if (d.faculty_already_verified) {
        // Skip verification — go straight to active
        setPhase(PHASE.ACTIVE)
        setStatusMsg(
          d.already_present_count > 0
            ? `Resumed: ${d.already_present_count} student(s) already marked. Continuing…`
            : 'Session resumed. Scanning for students…'
        )
      } else {
        setPhase(PHASE.VERIFY_FACULTY)
        setStatusMsg('Look at the camera and blink to verify your identity.')
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Could not start session')
    }
  }

  const stopSession = async () => {
    setStopping(true)
    try {
      await api.post(`/attendance/sessions/${cid}/stop`)
      clearInterval(pollRef.current)
      // Final poll to get accurate count
      const r = await api.get(`/attendance/status/${cid}`)
      setPresent(r.data.present || [])
      setPhase(PHASE.DONE)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to stop')
    } finally { setStopping(false) }
  }

  // ── Frame handler ───────────────────────────────────────────────────────────
  const handleFrame = useCallback(async b64 => {
    if (phase !== PHASE.VERIFY_FACULTY && phase !== PHASE.ACTIVE) return
    // Drop frame if previous request is still in flight — prevents queue pileup
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const r = await api.post('/recognize', {
        image:    b64,
        class_id: cid,
        mode:     phase === PHASE.VERIFY_FACULTY ? 'faculty' : 'students',
      })
      setFaces(r.data.faces || [])

      if (phase === PHASE.VERIFY_FACULTY) {
        const ok = r.data.faces?.find(f => f.decision === 'FACULTY_VERIFIED')
        if (ok) {
          setPhase(PHASE.ACTIVE)
          setStatusMsg(`Verified: ${ok.name}. Session is now active.`)
        } else {
          // Check if backend says face not enrolled
          if (r.data.error) {
            setStatusMsg(`⚠️ ${r.data.error}`)
            return
          }
          const f = r.data.faces?.[0]
          setStatusMsg(
            !f                              ? 'No face detected — look straight at the camera and ensure good lighting.' :
            f.decision === 'FACULTY_VERIFIED' ? 'Verified!' :
            f.decision === 'SPOOF'          ? `${f.name} detected — blink slowly and naturally to confirm liveness.` :
            f.decision === 'NOT_ENROLLED'   ? '⚠️ Your face photo is not enrolled. Ask admin to add it in your profile.' :
            f.decision === 'DENIED'         ? 'Face not recognised — move closer, improve lighting, or check your enrolled photo.' :
                                              'Verifying…'
          )
        }
      } else {
        const granted = r.data.faces?.filter(f => f.decision === 'GRANTED') || []
        setStatusMsg(
          granted.length         ? `Recognised: ${granted.map(f => f.name).join(', ')}` :
          r.data.faces?.length   ? (
            r.data.faces[0].decision === 'SPOOF' ? 'Blink to confirm liveness' : 'Scanning…'
          ) : 'Scanning for faces…'
        )
      }
    } catch { /* ignore transient network errors */ }
    finally  { inFlightRef.current = false }
  }, [phase, cid])

  const decisionStyle = d => ({
    GRANTED:          'bg-emerald-50 border-emerald-200 text-emerald-700',
    FACULTY_VERIFIED: 'bg-brand-50 border-brand-200 text-brand-700',
    SPOOF:            'bg-amber-50 border-amber-200 text-amber-700',
    DENIED:           'bg-red-50 border-red-200 text-red-600',
  }[d] || 'bg-gray-50 border-gray-200 text-gray-500')

  const remaining = total - present.length

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (phase === PHASE.LOADING) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-200 border-t-brand-600" />
    </div>
  )

  return (
    <div className="space-y-5 animate-slide-up">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Attendance Session</h1>
          {cls && (
            <p className="text-gray-500 text-sm mt-1 flex items-center gap-2 flex-wrap">
              <span className="badge-blue">{cls.name} / {cls.section}</span>
              {phase === PHASE.ACTIVE && (
                <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse-slow" />
                  Live
                </span>
              )}
              {total > 0 && phase !== PHASE.DONE && (
                <span className="text-xs text-gray-400">
                  {present.length}/{total} marked · {remaining} remaining
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {phase === PHASE.IDLE && (
            <button className="btn-primary" onClick={startSession}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {resuming ? 'Resume Session' : 'Start Session'}
            </button>
          )}
          {(phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE) && (
            <button className="btn-danger" onClick={stopSession} disabled={stopping}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              {stopping ? 'Stopping…' : 'Stop Session'}
            </button>
          )}
          {phase === PHASE.DONE && (
            <button className="btn-primary" onClick={() => navigate('/reports')}>
              View Report →
            </button>
          )}
        </div>
      </div>

      {/* ── Status banner ── */}
      {phase !== PHASE.IDLE && phase !== PHASE.LOADING && (
        <div className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium border
          ${phase === PHASE.VERIFY_FACULTY ? 'bg-amber-50 text-amber-800 border-amber-200' :
            phase === PHASE.ACTIVE         ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                             'bg-gray-50 text-gray-700 border-gray-200'}`}>
          {phase === PHASE.VERIFY_FACULTY && (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          )}
          {phase === PHASE.ACTIVE && (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {phase === PHASE.DONE && (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {statusMsg}
        </div>
      )}

      {/* ── Idle / resume state ── */}
      {phase === PHASE.IDLE && (
        <div className="space-y-4">
          {/* Resume notice — shown when there's already activity today */}
          {resuming && present.length > 0 && (
            <div className="alert-info flex items-start gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <div className="font-semibold">Session in progress for today</div>
                <div className="text-sm mt-0.5 opacity-80">
                  {present.length} student{present.length !== 1 ? 's' : ''} already marked present.
                  {remaining > 0
                    ? ` ${remaining} student${remaining !== 1 ? 's' : ''} still pending — resume to continue.`
                    : ' All students have been marked!'}
                </div>
              </div>
            </div>
          )}

          <div className="card p-8 sm:p-10 text-center max-w-xl mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-brand-50 flex items-center justify-center mx-auto mb-5">
              <svg className="w-10 h-10 text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {resuming ? 'Resume Attendance?' : 'Ready to Start?'}
            </h2>
            <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto">
              {resuming
                ? 'Face verification is already done for today. The session will resume scanning for remaining students immediately.'
                : 'Verify your identity first, then the system marks students automatically. No duplicate entries are created.'}
            </p>

            {/* How-it-works steps */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center text-left mb-6">
              {(resuming
                ? [
                    { n: '✓', title: 'Verified',     desc: 'Faculty ID confirmed today',       done: true },
                    { n: '2', title: 'Resume Scan',   desc: 'Picks up from where it stopped',  done: false },
                    { n: '3', title: 'Stop & Export', desc: 'View full report when done',       done: false },
                  ]
                : [
                    { n: '1', title: 'Verify You',    desc: 'Blink to prove you\'re live',      done: false },
                    { n: '2', title: 'Scan Students', desc: 'Auto-marks — no duplicates',       done: false },
                    { n: '3', title: 'Stop & Export', desc: 'View full report when done',       done: false },
                  ]
              ).map(step => (
                <div key={step.n} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 flex-1
                  ${step.done ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${step.done ? 'bg-emerald-500 text-white' : 'bg-brand-500 text-white'}`}>
                    {step.done ? '✓' : step.n}
                  </div>
                  <div>
                    <div className={`text-xs font-semibold ${step.done ? 'text-emerald-800' : 'text-gray-800'}`}>
                      {step.title}
                    </div>
                    <div className="text-[11px] text-gray-400">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn-primary btn-lg" onClick={startSession}>
              {resuming ? 'Resume Attendance Session' : 'Start Attendance Session'}
            </button>
          </div>

          {/* Already-present mini-list on resume */}
          {resuming && present.length > 0 && (
            <div className="card overflow-hidden max-w-xl mx-auto">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="font-semibold text-sm text-gray-800">Already Marked Today</span>
                <span className="badge-green">{present.length}</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-52 overflow-auto">
                {present.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-emerald-600 font-bold text-xs">{s.name?.[0]?.toUpperCase()}</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.roll_number}</div>
                      </div>
                    </div>
                    <span className="badge-green text-xs">{s.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Done state ── */}
      {phase === PHASE.DONE && (
        <div className="card p-8 sm:p-10 text-center max-w-lg mx-auto">
          <div className="w-20 h-20 rounded-3xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">Session Complete</h2>
          <div className="flex items-center justify-center gap-6 mb-5">
            <div className="text-center">
              <div className="text-3xl font-bold text-emerald-600">{present.length}</div>
              <div className="text-xs text-gray-400 mt-0.5">Present</div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="text-center">
              <div className="text-3xl font-bold text-red-500">{Math.max(0, total - present.length)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Absent</div>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-700">{total}</div>
              <div className="text-xs text-gray-400 mt-0.5">Total</div>
            </div>
          </div>
          <button className="btn-primary btn-lg" onClick={() => navigate('/reports')}>
            View Full Report
          </button>
        </div>
      )}

      {/* ── Active / verifying ── */}
      {(phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE) && (
        <div className="flex flex-col lg:flex-row gap-4">

          {/* Camera panel */}
          <div className="flex-1 min-w-0">
            <div className="card overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0
                    ${phase === PHASE.ACTIVE ? 'bg-emerald-500 animate-pulse-slow' : 'bg-amber-500 animate-pulse-slow'}`} />
                  <span className="font-semibold text-sm text-gray-800">
                    {phase === PHASE.VERIFY_FACULTY ? 'Faculty Verification' : 'Live Recognition'}
                  </span>
                </div>
                {faces.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {faces.map((f, i) => (
                      <span key={i}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${decisionStyle(f.decision)}`}>
                        {f.name} · {f.decision}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <CameraView
                onFrame={handleFrame}
                faces={faces}
                intervalMs={300}
                active={phase === PHASE.VERIFY_FACULTY || phase === PHASE.ACTIVE}
              />
            </div>
          </div>

          {/* Present / progress panel */}
          <div className="w-full lg:w-72 flex-shrink-0 space-y-3">

            {/* Progress bar */}
            {total > 0 && (
              <div className="card p-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-gray-700">Progress</span>
                  <span className="font-bold text-brand-600">{present.length}/{total}</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((present.length / total) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                  <span>{present.length} present</span>
                  <span>{remaining} remaining</span>
                </div>
              </div>
            )}

            {/* Present list */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="font-semibold text-sm text-gray-800">Present Today</span>
                <span className="badge-green font-bold">{present.length}</span>
              </div>
              <div className="overflow-auto max-h-96 lg:max-h-[calc(100vh-380px)]">
                {present.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-gray-300 gap-2">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-gray-400">Waiting for recognitions…</span>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {present.map(s => (
                      <div key={s.id}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                            <span className="text-emerald-600 font-bold text-xs">
                              {s.name?.[0]?.toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
                            <div className="text-xs text-gray-400">{s.roll_number}</div>
                          </div>
                        </div>
                        <span className="badge-green text-xs flex-shrink-0 ml-2">{s.time}</span>
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
