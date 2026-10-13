import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * CameraView
 * - Uses browser getUserMedia (device camera — works on any device on the network)
 * - Sends real (unmirrored) JPEG frames to the server for face recognition
 * - Displays a natural mirror view to the user
 * - Draws bounding boxes correctly on the mirror view
 * - Handles mobile camera permission errors with clear guidance
 */
export default function CameraView({ onFrame, faces = [], intervalMs = 500, active = true }) {
  const videoRef   = useRef(null)
  const captureRef = useRef(null)   // hidden canvas — real orientation for server
  const overlayRef = useRef(null)   // visible canvas — mirrored for display
  const streamRef  = useRef(null)
  const timerRef   = useRef(null)
  const [error, setError]   = useState(null)
  const [ready, setReady]   = useState(false)
  const [isHttpWarning, setIsHttpWarning] = useState(false)

  // ── Start camera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    // Warn immediately if accessing over non-secure HTTP from a remote device
    // (localhost is always allowed; other origins need HTTPS for getUserMedia)
    const isRemoteHttp =
      location.protocol === 'http:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    if (isRemoteHttp) {
      setIsHttpWarning(true)
      // Still try — some browsers allow it on LAN
    }

    const constraints = {
      video: {
        facingMode: 'user',
        width:  { ideal: 640 },
        height: { ideal: 480 },
      }
    }

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          // onloadedmetadata may not fire on some mobile browsers — use both
          v.onloadedmetadata = () => { if (!cancelled) setReady(true) }
          v.oncanplay        = () => { if (!cancelled) setReady(true) }
        }
      })
      .catch(err => {
        if (cancelled) return
        const msg = err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser settings and reload.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : err.name === 'NotReadableError'
          ? 'Camera is already in use by another app. Close it and reload.'
          : `Camera error: ${err.message}`
        setError(msg)
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      setReady(false)
    }
  }, [])

  // ── Capture loop — sends REAL (unmirrored) frame to server ────────────────
  const capture = useCallback(() => {
    const v = videoRef.current
    const c = captureRef.current
    if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return

    c.width  = v.videoWidth
    c.height = v.videoHeight
    // Draw WITHOUT mirroring — server needs the real image
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    onFrame?.(c.toDataURL('image/jpeg', 0.8))
  }, [onFrame])

  useEffect(() => {
    if (active && ready) {
      timerRef.current = setInterval(capture, intervalMs)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [active, ready, capture, intervalMs])

  // ── Draw bounding boxes on overlay canvas (mirrored to match display) ─────
  useEffect(() => {
    const ov = overlayRef.current
    const v  = videoRef.current
    if (!ov || !v) return

    // Match canvas pixel size to the displayed video element size
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

    faces.forEach(f => {
      if (!f.box) return
      const [top, right, bottom, left] = f.box  // face_recognition returns (top,right,bottom,left)

      // Mirror the X coordinates to match the mirrored video display
      const displayLeft  = ov.width - right  * scaleX
      const displayRight = ov.width - left   * scaleX
      const displayTop   = top    * scaleY
      const displayBot   = bottom * scaleY
      const w = displayRight - displayLeft
      const h = displayBot   - displayTop

      const color =
        f.decision === 'GRANTED' || f.decision === 'FACULTY_VERIFIED' ? '#22c55e' :
        f.decision === 'SPOOF'   ? '#f59e0b' : '#ef4444'

      // Box
      ctx.strokeStyle = color
      ctx.lineWidth   = 3
      ctx.strokeRect(displayLeft, displayTop, w, h)

      // Label
      const label = `${f.name || '?'} · ${f.decision}`
      ctx.font = 'bold 13px sans-serif'
      const tw = ctx.measureText(label).width + 12
      const labelY = Math.max(0, displayTop - 24)
      ctx.fillStyle = color
      ctx.fillRect(displayLeft, labelY, tw, 22)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, displayLeft + 6, labelY + 15)
    })
  }, [faces])

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-64 bg-gray-900 text-white p-6 text-center rounded-xl gap-3">
      <div className="text-4xl">📷</div>
      <div className="text-sm font-medium text-red-300">{error}</div>
      {isHttpWarning && (
        <div className="text-xs text-yellow-300 bg-yellow-900/40 rounded-lg p-3 max-w-xs">
          ⚠️ Mobile browsers require <strong>HTTPS</strong> to access the camera from a network address.
          Either open this page on the same device as the server (localhost), or set up HTTPS.
        </div>
      )}
      <button
        className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
        onClick={() => { setError(null); setReady(false); window.location.reload() }}
      >
        Retry
      </button>
    </div>
  )

  return (
    <div className="relative bg-black rounded-xl overflow-hidden select-none" style={{ minHeight: 240 }}>
      {/* Video — mirrored for natural selfie view */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full block"
        style={{ transform: 'scaleX(-1)', display: ready ? 'block' : 'none' }}
      />

      {/* Overlay canvas for bounding boxes — positioned over the mirrored video */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Hidden canvas for server capture — NO mirror */}
      <canvas ref={captureRef} className="hidden" />

      {/* Loading state */}
      {!ready && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          <div className="text-white text-sm">Starting camera…</div>
          {isHttpWarning && (
            <div className="text-xs text-yellow-300 bg-yellow-900/40 rounded-lg p-3 max-w-xs text-center mx-4">
              ⚠️ On mobile, camera access requires <strong>HTTPS</strong> or using the server device directly.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
