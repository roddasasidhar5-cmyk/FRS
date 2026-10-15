import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * CameraView
 * - Uses browser getUserMedia (device camera)
 * - Sends real (unmirrored) JPEG frames to the server for face recognition
 * - Displays a natural mirror view for front camera, straight view for back
 * - Draws bounding boxes correctly on both modes
 * - Flip button: toggles between front ('user') and rear ('environment') camera
 */
export default function CameraView({ onFrame, faces = [], intervalMs = 500, active = true }) {
  const videoRef   = useRef(null)
  const captureRef = useRef(null)   // hidden canvas — real orientation for server
  const overlayRef = useRef(null)   // visible canvas — for bounding boxes
  const streamRef  = useRef(null)
  const timerRef   = useRef(null)

  const [error, setError]         = useState(null)
  const [ready, setReady]         = useState(false)
  const [facingMode, setFacingMode] = useState('user')        // 'user' | 'environment'
  const [flipping, setFlipping]   = useState(false)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [isHttpWarning, setIsHttpWarning] = useState(false)

  // ── Check if device has more than one camera (show flip button only if so) ─
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then(devices => {
        const cams = devices.filter(d => d.kind === 'videoinput')
        setHasMultipleCameras(cams.length > 1)
      })
      .catch(() => {
        // Assume mobile has multiple cameras if we can't enumerate
        setHasMultipleCameras(true)
      })
  }, [])

  // ── Start / restart camera whenever facingMode changes ─────────────────────
  useEffect(() => {
    let cancelled = false

    const isRemoteHttp =
      location.protocol === 'http:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    if (isRemoteHttp) setIsHttpWarning(true)

    // Stop any existing stream first
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setReady(false)
    setError(null)

    // Camera API not available (HTTP on mobile blocks mediaDevices entirely)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(
        isRemoteHttp
          ? 'Camera blocked: mobile browsers require HTTPS to access the camera over a network. Ask your admin to enable HTTPS.'
          : 'Camera not available on this browser/device.'
      )
      return
    }

    const constraints = {
      video: {
        facingMode: { ideal: facingMode },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      }
    }

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.onloadedmetadata = () => { if (!cancelled) { setReady(true); setFlipping(false) } }
          v.oncanplay        = () => { if (!cancelled) { setReady(true); setFlipping(false) } }
        }
      })
      .catch(err => {
        if (cancelled) return
        setFlipping(false)
        // If rear camera not available fall back to front
        if (facingMode === 'environment') {
          setFacingMode('user')
          return
        }
        const msg =
          err.name === 'NotAllowedError'  ? 'Camera permission denied. Allow camera access and reload.' :
          err.name === 'NotFoundError'    ? 'No camera found on this device.' :
          err.name === 'NotReadableError' ? 'Camera is in use by another app. Close it and reload.' :
                                           `Camera error: ${err.message}`
        setError(msg)
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setReady(false)
    }
  }, [facingMode])

  // ── Flip handler ────────────────────────────────────────────────────────────
  const handleFlip = () => {
    if (flipping) return
    setFlipping(true)
    setFacingMode(m => m === 'user' ? 'environment' : 'user')
  }

  // ── Capture loop ────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const v = videoRef.current
    const c = captureRef.current
    if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return

    // Capture at max 640px wide — enough for face recognition, much smaller payload
    const MAX_W = 640
    const scale = Math.min(1, MAX_W / v.videoWidth)
    c.width  = Math.round(v.videoWidth  * scale)
    c.height = Math.round(v.videoHeight * scale)
    // Always draw without any CSS transform — server sees real pixels
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    onFrame?.(c.toDataURL('image/jpeg', 0.6))   // 0.6 quality — sharp enough, ~40% smaller
  }, [onFrame])

  useEffect(() => {
    if (active && ready) {
      timerRef.current = setInterval(capture, intervalMs)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [active, ready, capture, intervalMs])

  // ── Bounding box overlay ────────────────────────────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current
    const v  = videoRef.current
    if (!ov || !v) return

    const rect = v.getBoundingClientRect()
    ov.width  = rect.width  || v.clientWidth  || 640
    ov.height = rect.height || v.clientHeight || 480

    const ctx = ov.getContext('2d')
    ctx.clearRect(0, 0, ov.width, ov.height)
    if (!faces.length) return

    const vw = v.videoWidth  || 640
    const vh = v.videoHeight || 480
    const scaleX = ov.width  / vw
    const scaleY = ov.height / vh
    const isFront = facingMode === 'user'

    faces.forEach(f => {
      if (!f.box) return
      const [top, right, bottom, left] = f.box  // face_recognition: (top,right,bottom,left)

      // Mirror X only for front camera (where CSS also mirrors the video)
      const displayLeft  = isFront ? ov.width - right * scaleX : left  * scaleX
      const displayRight = isFront ? ov.width - left  * scaleX : right * scaleX
      const displayTop   = top    * scaleY
      const displayBot   = bottom * scaleY
      const w = displayRight - displayLeft
      const h = displayBot   - displayTop

      const color =
        f.decision === 'GRANTED' || f.decision === 'FACULTY_VERIFIED' ? '#22c55e' :
        f.decision === 'SPOOF'   ? '#f59e0b' : '#ef4444'

      ctx.strokeStyle = color
      ctx.lineWidth   = 3
      ctx.strokeRect(displayLeft, displayTop, w, h)

      const label = `${f.name || '?'} · ${f.decision}`
      ctx.font = 'bold 13px sans-serif'
      const tw = ctx.measureText(label).width + 12
      const labelY = Math.max(0, displayTop - 24)
      ctx.fillStyle = color
      ctx.fillRect(displayLeft, labelY, tw, 22)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, displayLeft + 6, labelY + 15)
    })
  }, [faces, facingMode])

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-64 bg-gray-900 text-white p-6 text-center rounded-xl gap-3">
      <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-1">
        <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
      <div className="text-sm font-medium text-red-300">{error}</div>
      {isHttpWarning && (
        <div className="text-xs text-amber-300 bg-amber-900/40 rounded-lg p-3 max-w-xs">
          ⚠️ Mobile browsers require <strong>HTTPS</strong> to access the camera from a network address.
        </div>
      )}
      <button
        className="mt-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-xl font-medium transition"
        onClick={() => { setError(null); setReady(false); setFacingMode('user') }}
      >
        Retry
      </button>
    </div>
  )

  // Mirror the video for front camera only (natural selfie view)
  const videoStyle = {
    transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
    display:   ready ? 'block' : 'none',
  }

  return (
    <div className="relative bg-black rounded-xl overflow-hidden select-none" style={{ minHeight: 240 }}>
      {/* Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full block"
        style={videoStyle}
      />

      {/* Bounding box overlay */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Hidden capture canvas (no transform — server needs real pixels) */}
      <canvas ref={captureRef} className="hidden" />

      {/* ── Flip camera button ── */}
      {ready && (hasMultipleCameras || facingMode === 'environment') && (
        <button
          onClick={handleFlip}
          disabled={flipping}
          title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
          className={`
            absolute top-3 right-3 z-10
            w-10 h-10 rounded-full
            bg-black/50 backdrop-blur-sm
            border border-white/20
            flex items-center justify-center
            text-white
            transition-all duration-200
            hover:bg-black/70 active:scale-95
            ${flipping ? 'opacity-50 cursor-not-allowed' : 'opacity-90 hover:opacity-100'}
          `}
        >
          {flipping ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      )}

      {/* Camera mode badge */}
      {ready && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5
                        bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1
                        border border-white/20">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white text-[11px] font-medium">
            {facingMode === 'user' ? 'Front Camera' : 'Back Camera'}
          </span>
        </div>
      )}

      {/* Loading state */}
      {!ready && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 gap-3">
          {flipping ? (
            <>
              <svg className="animate-spin h-8 w-8 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div className="text-white text-sm">Switching camera…</div>
            </>
          ) : (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
              <div className="text-white text-sm">Starting camera…</div>
            </>
          )}
          {isHttpWarning && (
            <div className="text-xs text-amber-300 bg-amber-900/40 rounded-lg p-3 max-w-xs text-center mx-4">
              ⚠️ Mobile browsers need <strong>HTTPS</strong> to access the camera over a network.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
