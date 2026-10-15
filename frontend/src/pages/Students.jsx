import { useEffect, useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── CSV parser (handles quoted fields) ───────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []

  // Detect header row
  const first = lines[0].toLowerCase()
  const hasHeader = first.includes('name') || first.includes('roll')
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map((line, i) => {
    // Split by comma, handle quoted values
    const cols = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cols.push(cur.trim())

    return {
      _row:        i + (hasHeader ? 2 : 1),
      name:        cols[0] || '',
      roll_number: cols[1] || '',
      // col[2] optional class_id override — filled from selected class later
      _raw:        line,
    }
  }).filter(r => r.name || r.roll_number)
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateRows(rows, classId) {
  const rollsSeen = new Set()
  return rows.map(r => {
    const errs = []
    if (!r.name.trim())        errs.push('Name is empty')
    if (!r.roll_number.trim()) errs.push('Roll number is empty')
    if (!classId)              errs.push('No class selected')
    if (r.roll_number && rollsSeen.has(r.roll_number.toLowerCase()))
      errs.push('Duplicate roll number in this upload')
    if (r.roll_number) rollsSeen.add(r.roll_number.toLowerCase())
    return { ...r, _errors: errs, _ok: errs.length === 0 }
  })
}

// ── Template CSV ──────────────────────────────────────────────────────────────
const TEMPLATE_CSV = `name,roll_number
Rahul Kumar,242UA05301
Priya Sharma,242UA05302
Arjun Singh,242UA05303
`

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = 'students_template.csv'
  a.click()
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK UPLOAD PANEL
// ─────────────────────────────────────────────────────────────────────────────
function BulkUpload({ classes, defaultClassId, onDone, onCancel }) {
  const [classId,   setClassId]   = useState(defaultClassId || '')
  const [rows,      setRows]      = useState([])       // parsed + validated rows
  const [uploading, setUploading] = useState(false)
  const [result,    setResult]    = useState(null)     // server response
  const [dragOver,  setDragOver]  = useState(false)
  const fileRef = useRef()

  // Re-validate when class changes
  useEffect(() => {
    if (rows.length) setRows(r => validateRows(r, classId))
  }, [classId])

  const processText = text => {
    const parsed    = parseCSV(text)
    const validated = validateRows(parsed, classId)
    setRows(validated)
    setResult(null)
  }

  const handleFile = file => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => processText(e.target.result)
    reader.readAsText(file)
  }

  const handleDrop = e => {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  const handlePaste = e => {
    const text = e.clipboardData.getData('text')
    if (text) { e.preventDefault(); processText(text) }
  }

  const editCell = (idx, field, val) => {
    setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: val }
      return validateRows(next, classId)
    })
  }

  const removeRow = idx => setRows(prev => {
    const next = prev.filter((_, i) => i !== idx)
    return validateRows(next, classId)
  })

  const validRows  = rows.filter(r => r._ok)
  const invalidRows = rows.filter(r => !r._ok)

  const handleUpload = async () => {
    if (!validRows.length || !classId) return
    setUploading(true)
    try {
      const payload = validRows.map(r => ({
        name:        r.name.trim(),
        roll_number: r.roll_number.trim(),
        class_id:    Number(classId),
      }))
      const res = await api.post('/students/bulk', { students: payload })
      setResult(res.data)
      if (res.data.inserted > 0) onDone()
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Upload failed' })
    } finally { setUploading(false) }
  }

  return (
    <div className="card p-5 border-brand-200/60 bg-brand-50/20 animate-slide-up space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-gray-900">Bulk Upload Students</h2>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-secondary btn-sm gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Template
          </button>
          <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-600 space-y-1.5">
        <p className="font-semibold text-gray-800">How to use:</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>Download the CSV template or prepare a CSV/Excel with columns: <code className="bg-gray-100 px-1 rounded text-xs">name</code>, <code className="bg-gray-100 px-1 rounded text-xs">roll_number</code></li>
          <li>Select the class below, then drag-drop your file or paste data directly</li>
          <li>Review the preview table — edit or remove any row with errors</li>
          <li>Click <strong>Upload All</strong> to add them</li>
        </ol>
        <p className="text-xs text-gray-400 pt-1">Supports .csv, .txt · Max 500 students · Duplicate roll numbers are skipped</p>
      </div>

      {/* Class selector */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Target Class <span className="text-red-500">*</span></label>
          <select className="input select" value={classId}
            onChange={e => setClassId(e.target.value)}>
            <option value="">Select class for all students</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      {rows.length === 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onPaste={handlePaste}
          tabIndex={0}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-150 cursor-pointer outline-none
            ${dragOver
              ? 'border-brand-400 bg-brand-50'
              : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/40'}
            focus:border-brand-400 focus:bg-brand-50/30`}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={e => handleFile(e.target.files[0])} />
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="font-semibold text-gray-700 mb-1">Drop CSV file here</p>
          <p className="text-sm text-gray-400">or click to browse · or focus here and <kbd className="bg-gray-100 border border-gray-200 rounded px-1 text-xs">Ctrl+V</kbd> to paste</p>
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="space-y-3">

          {/* Stats bar */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge-green">{validRows.length} ready</span>
            {invalidRows.length > 0 && <span className="badge-red">{invalidRows.length} with errors</span>}
            <button
              onClick={() => { setRows([]); setResult(null) }}
              className="btn-secondary btn-sm ml-auto">
              Clear & re-upload
            </button>
          </div>

          {/* Editable table */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-8">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">Full Name</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">Roll Number</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => (
                    <tr key={i} className={r._ok ? 'bg-white hover:bg-gray-50' : 'bg-red-50'}>
                      <td className="px-3 py-2 text-xs text-gray-400">{r._row}</td>
                      <td className="px-2 py-1.5">
                        <input
                          className={`w-full px-2 py-1 text-sm rounded-lg border outline-none focus:ring-1
                            ${r._errors?.some(e => e.includes('Name'))
                              ? 'border-red-300 bg-red-50 focus:ring-red-400'
                              : 'border-gray-200 focus:ring-brand-400'}`}
                          value={r.name}
                          onChange={e => editCell(i, 'name', e.target.value)}
                          placeholder="Student name"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={`w-full px-2 py-1 text-sm rounded-lg border outline-none focus:ring-1 font-mono
                            ${r._errors?.some(e => e.includes('roll') || e.includes('Roll') || e.includes('Duplicate'))
                              ? 'border-red-300 bg-red-50 focus:ring-red-400'
                              : 'border-gray-200 focus:ring-brand-400'}`}
                          value={r.roll_number}
                          onChange={e => editCell(i, 'roll_number', e.target.value)}
                          placeholder="Roll number"
                        />
                        {r._errors?.filter(e => e.includes('roll') || e.includes('Roll') || e.includes('Duplicate')).map((e, j) => (
                          <div key={j} className="text-[10px] text-red-500 mt-0.5">{e}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeRow(i)}
                          className="w-6 h-6 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition flex items-center justify-center">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload button */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleUpload}
              disabled={uploading || validRows.length === 0 || !classId}
              className="btn-primary gap-2">
              {uploading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Uploading…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Upload {validRows.length} Student{validRows.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
            {!classId && (
              <span className="text-xs text-amber-600 font-medium">⚠ Select a class first</span>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-xl p-4 border space-y-2 animate-slide-up
          ${result.error ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          {result.error ? (
            <p className="text-red-700 text-sm font-medium">❌ {result.error}</p>
          ) : (
            <>
              <p className="font-semibold text-emerald-800">
                ✓ Upload complete
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="badge-green">{result.inserted} added</span>
                {result.duplicates > 0 && <span className="badge-yellow">{result.duplicates} skipped (duplicate roll no.)</span>}
                {result.errors    > 0 && <span className="badge-red">{result.errors} failed</span>}
              </div>
              {result.duplicate_students?.length > 0 && (
                <div className="text-xs text-amber-700 mt-1">
                  Skipped: {result.duplicate_students.map(d => d.roll_number).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Students() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const classFilter  = searchParams.get('class_id') || ''

  const [students,  setStudents]  = useState([])
  const [classes,   setClasses]   = useState([])
  const [pctMap,    setPctMap]    = useState({})
  const [panel,     setPanel]     = useState(null)    // null | 'single' | 'bulk'
  const [form,      setForm]      = useState({ name: '', roll_number: '', class_id: classFilter })
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const isSuperAdmin = user?.role === 'super_admin'

  const load = () => {
    const p = classFilter ? `?class_id=${classFilter}` : ''
    api.get(`/students${p}`).then(r => setStudents(r.data)).catch(() => {})
    api.get(`/attendance/percentage${p}`)
      .then(r => {
        const map = {}
        ;(r.data.students || []).forEach(s => {
          map[s.student_id] = { percentage: s.percentage, status: s.status }
        })
        setPctMap(map)
      })
      .catch(() => {})
  }

  useEffect(() => { load() }, [classFilter])
  useEffect(() => { api.get('/classes').then(r => setClasses(r.data)).catch(() => {}) }, [])

  const handleAdd = async e => {
    e.preventDefault(); setError('')
    try {
      await api.post('/students', { ...form, class_id: Number(form.class_id) })
      setForm({ name: '', roll_number: '', class_id: classFilter })
      setPanel(null); load()
    } catch (err) { setError(err.response?.data?.error || 'Failed') }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this student?')) return
    try { await api.delete(`/students/${id}`); load() }
    catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  const filtered = students.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.roll_number.toLowerCase().includes(search.toLowerCase())
  )

  const closePanel = () => { setPanel(null); setError('') }

  return (
    <div className="space-y-6 animate-slide-up">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="text-gray-500 text-sm mt-1">
            {students.length} student{students.length !== 1 ? 's' : ''} enrolled
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isSuperAdmin && (
            <Link to="/attendance/percentage" className="btn-secondary btn-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
              </svg>
              Attendance %
            </Link>
          )}
          {/* Bulk upload — admin + faculty can both upload */}
          <button
            className={panel === 'bulk' ? 'btn-secondary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setPanel(p => p === 'bulk' ? null : 'bulk')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {panel === 'bulk' ? 'Cancel Bulk' : 'Bulk Upload'}
          </button>
          <button
            className={panel === 'single' ? 'btn-secondary' : 'btn-primary'}
            onClick={() => setPanel(p => p === 'single' ? null : 'single')}>
            {panel === 'single' ? (
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
                Add Student
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Search + class filter ── */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input className="input pl-9" placeholder="Search students…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input select max-w-[220px]" value={classFilter}
          onChange={e => setSearchParams(e.target.value ? { class_id: e.target.value } : {})}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
        </select>
        {classFilter && (
          <button className="btn-secondary btn-sm" onClick={() => setSearchParams({})}>Clear filter</button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* ── Single add form ── */}
      {panel === 'single' && (
        <div className="card p-5 border-brand-200/60 bg-brand-50/30 animate-slide-up">
          <h2 className="font-semibold text-gray-900 mb-4">Add Student</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Full Name</label>
              <input className="input" required placeholder="Student full name"
                value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div>
              <label className="label">Roll Number</label>
              <input className="input" required placeholder="e.g. CS2021001"
                value={form.roll_number} onChange={e => setForm(f => ({...f, roll_number: e.target.value}))} />
            </div>
            <div>
              <label className="label">Class</label>
              <select className="input select" required value={form.class_id}
                onChange={e => setForm(f => ({...f, class_id: e.target.value}))}>
                <option value="">Select class</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name} / {c.section}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3 flex gap-2">
              <button type="submit" className="btn-primary btn-sm">Add Student</button>
              <button type="button" className="btn-secondary btn-sm" onClick={closePanel}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Bulk upload panel ── */}
      {panel === 'bulk' && (
        <BulkUpload
          classes={classes}
          defaultClassId={classFilter}
          onDone={() => { load(); setPanel(null) }}
          onCancel={closePanel}
        />
      )}

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-2">
        {filtered.map(s => (
          <div key={s.id} className="card p-4 flex justify-between items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                <span className="text-brand-600 font-bold text-sm">{s.name[0].toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">{s.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.roll_number} · {s.class_name} / {s.section}</div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={s.face_count > 0 ? 'badge-green' : 'badge-yellow'}>
                    {s.face_count} photo{s.face_count !== 1 ? 's' : ''}
                  </span>
                  {pctMap[s.id] && (
                    <span className={`badge text-xs font-bold
                      ${pctMap[s.id].status === 'Good'     ? 'badge-green'  :
                        pctMap[s.id].status === 'Low'      ? 'badge-yellow' :
                        pctMap[s.id].status === 'Critical' ? 'badge-red'    : 'badge-gray'}`}>
                      {pctMap[s.id].percentage !== null ? `${pctMap[s.id].percentage}%` : '—'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Link to={`/students/${s.id}`} className="btn-secondary btn-sm text-xs">View</Link>
              {isSuperAdmin && (
                <button
                  className="btn-sm text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg px-3 py-1.5 text-xs transition"
                  onClick={() => handleDelete(s.id)}>Del</button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            </div>
            <p className="font-medium text-gray-500">No students found</p>
          </div>
        )}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Roll No</th>
                <th>Class</th>
                <th>Face Photos</th>
                <th>Attendance %</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-brand-600 font-bold text-xs">{s.name[0].toUpperCase()}</span>
                      </div>
                      <span className="font-medium text-gray-900">{s.name}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-500">{s.roll_number}</td>
                  <td><span className="badge-blue">{s.class_name} / {s.section}</span></td>
                  <td>
                    <span className={s.face_count > 0 ? 'badge-green' : 'badge-yellow'}>
                      {s.face_count > 0 ? (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd" />
                        </svg>
                      ) : '!'}
                      {s.face_count} {s.face_count === 1 ? 'photo' : 'photos'}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const p = pctMap[s.id]
                      if (!p) return <span className="text-gray-300 text-xs">—</span>
                      const pct = p.percentage
                      return (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              pct === null ? 'w-0' :
                              pct >= 75   ? 'bg-emerald-500' :
                              pct >= 65   ? 'bg-amber-400'   : 'bg-red-500'
                            }`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-bold ${
                            pct === null  ? 'text-gray-400'    :
                            pct >= 75    ? 'text-emerald-600'  :
                            pct >= 65    ? 'text-amber-600'    : 'text-red-600'}`}>
                            {pct !== null ? `${pct}%` : '—'}
                          </span>
                        </div>
                      )
                    })()}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Link to={`/students/${s.id}`} className="btn-secondary btn-sm">View</Link>
                      {isSuperAdmin && (
                        <button
                          className="btn-sm text-red-500 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition"
                          onClick={() => handleDelete(s.id)}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                      </svg>
                      No students found
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
