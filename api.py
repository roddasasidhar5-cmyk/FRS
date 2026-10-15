"""
AttendAI — Flask JSON API backend
React frontend served from /static/react/

Roles: super_admin | faculty
Attendance flow:
  1. Faculty POSTs /api/attendance/sessions  (creates session)
  2. Faculty verifies face via POST /api/recognize?mode=faculty
  3. Students recognised via POST /api/recognize?mode=students (multi-face)
  4. Faculty POSTs /api/attendance/sessions/<class_id>/stop
"""

import os, uuid, time, threading, base64, csv, io, pathlib
from math import dist
from datetime import date, datetime
from functools import wraps

import sqlite3
import numpy as np
import cv2
import face_recognition
from PIL import Image as PILImage
from flask import (Flask, jsonify, request, abort,
                   send_file, send_from_directory, session)
from flask_login import (LoginManager, UserMixin, login_user,
                         logout_user, login_required, current_user)
from werkzeug.security import generate_password_hash, check_password_hash
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib import colors as rl_colors
from reportlab.lib.styles import getSampleStyleSheet

# ─────────────────────── CONFIG ─────────────────────────────────────────────
MATCH_TOLERANCE  = 0.58
EAR_THRESHOLD    = 0.21
LIVE_WINDOW_SEC  = 10.0
SCALE            = 0.4   # Reduced from 0.75 — processes ~512×288 instead of 960×540, ~3x faster

DB_PATH    = os.path.join(os.path.dirname(__file__), "attendance.db")
FACES_DIR  = os.path.join(os.path.dirname(__file__), "static", "faces")
USERS_FACES_DIR = os.path.join(os.path.dirname(__file__), "static", "user_faces")
ALLOWED_EXT = {"jpg", "jpeg", "png"}

_SECRET_FILE = os.path.join(os.path.dirname(__file__), ".secret_key")

def _load_secret():
    v = os.environ.get("SECRET_KEY", "").strip()
    if v: return v.encode()
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE, "rb") as f:
            val = f.read().strip()
            if val: return val
    import secrets as _s
    val = _s.token_hex(32).encode()
    with open(_SECRET_FILE, "wb") as f: f.write(val)
    return val

# ─────────────────────── APP ─────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = _load_secret()
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024

login_manager = LoginManager(app)
login_manager.login_view = None   # API-only — no redirect

os.makedirs(FACES_DIR, exist_ok=True)
os.makedirs(USERS_FACES_DIR, exist_ok=True)

# ─────────────────────── DB ──────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        username       TEXT UNIQUE NOT NULL,
        full_name      TEXT,
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'faculty',
        face_image_path TEXT,
        created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS classes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        section    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS students (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        roll_number TEXT NOT NULL,
        class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS student_faces (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        image_path  TEXT NOT NULL,
        created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS attendance (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id  INTEGER NOT NULL REFERENCES students(id),
        class_id    INTEGER NOT NULL REFERENCES classes(id),
        date        TEXT NOT NULL,
        time        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'present',
        marked_by   INTEGER REFERENCES users(id)
    );
    /* Unique guard — one row per student per class per day.
       Added safely: deduplicate existing data first, then create the index. */
    CREATE TABLE IF NOT EXISTS faculty_verifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        class_id   INTEGER NOT NULL REFERENCES classes(id),
        date       TEXT NOT NULL,
        time       TEXT NOT NULL,
        UNIQUE(user_id, class_id, date)
    );
    """)
    # ── Deduplicate existing attendance rows before adding unique index ────────
    # Keep only the earliest row per (student_id, class_id, date) combination
    conn.execute("""
        DELETE FROM attendance
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM attendance
            GROUP BY student_id, class_id, date
        )
    """)
    conn.commit()
    # Now safe to create the unique index
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_student_class_date
            ON attendance(student_id, class_id, date)
    """)
    # Seed super_admin
    if not conn.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role) VALUES (?,?,?,?)",
            ("admin", "Super Admin", generate_password_hash("admin123"), "super_admin")
        )
    conn.commit()
    conn.close()
    print("[DB] Initialised.")

# ─────────────────────── USER MODEL ──────────────────────────────────────────
class User(UserMixin):
    def __init__(self, row):
        self.id             = row["id"]
        self.username       = row["username"]
        self.full_name      = row["full_name"]
        self.password_hash  = row["password_hash"]
        self.role           = row["role"]
        self.face_image_path = row["face_image_path"]

@login_manager.user_loader
def load_user(uid):
    conn = get_db()
    row  = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return User(row) if row else None

@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"error": "Authentication required"}), 401

def super_admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or current_user.role != "super_admin":
            return jsonify({"error": "Super admin access required"}), 403
        return f(*args, **kwargs)
    return decorated

# ─────────────────────── FACE ENCODING STORE ─────────────────────────────────
faces_lock        = threading.Lock()
known_encodings   = []   # student face encodings (np arrays)
known_student_ids = []
known_names       = {}   # student_id → name

faculty_encodings    = []  # faculty face encodings
faculty_user_ids     = []
faculty_names        = {}  # user_id → display name
faculty_blink_state  = {}  # user_id → {closed_frames, last_blink_time}

def _load_image_rgb(path):
    """Load image, convert to RGB numpy array suitable for face_recognition."""
    img = PILImage.open(path)
    if img.mode != "RGB":
        img = img.convert("RGB")
    return np.array(img)

def reload_known_faces():
    global known_encodings, known_student_ids, known_names
    encs, ids, names = [], [], {}
    conn = get_db()
    rows = conn.execute(
        "SELECT sf.student_id, sf.image_path, s.name "
        "FROM student_faces sf JOIN students s ON s.id=sf.student_id"
    ).fetchall()
    conn.close()
    for row in rows:
        path = os.path.join(os.path.dirname(__file__), row["image_path"])
        try:
            img = _load_image_rgb(path)
            enc = face_recognition.face_encodings(img)
            if enc:
                encs.append(enc[0]); ids.append(row["student_id"])
                names[row["student_id"]] = row["name"]
            else:
                print(f"[ENROLL] No face in {path} for student '{row['name']}'")
        except Exception as e:
            print(f"[ENROLL] Failed {path}: {e}")
    with faces_lock:
        known_encodings, known_student_ids, known_names = encs, ids, names
    print(f"[ENROLL] Loaded {len(encs)} student face encodings.")

def reload_faculty_faces():
    global faculty_encodings, faculty_user_ids, faculty_names
    encs, ids, names = [], [], {}
    conn = get_db()
    rows = conn.execute(
        "SELECT id, full_name, username, face_image_path FROM users "
        "WHERE face_image_path IS NOT NULL"
    ).fetchall()
    conn.close()
    for row in rows:
        path = os.path.join(os.path.dirname(__file__), row["face_image_path"])
        try:
            img = _load_image_rgb(path)
            enc = face_recognition.face_encodings(img)
            if enc:
                encs.append(enc[0]); ids.append(row["id"])
                names[row["id"]] = row["full_name"] or row["username"]
            else:
                print(f"[FACULTY] No face in {path} for user '{row['username']}'")
        except Exception as e:
            print(f"[FACULTY] Failed {path}: {e}")
    with faces_lock:
        faculty_encodings, faculty_user_ids, faculty_names = encs, ids, names
    print(f"[FACULTY] Loaded {len(encs)} faculty face encodings.")

# ─────────────────────── EAR (liveness) ──────────────────────────────────────
def eye_aspect_ratio(eye):
    a = dist(eye[1], eye[5]); b = dist(eye[2], eye[4]); c = dist(eye[0], eye[3])
    return (a + b) / (2.0 * c) if c else 0.0

def check_liveness(lms, blink_state):
    """Update blink_state dict and return True if person is live."""
    now = time.time()
    ear = (eye_aspect_ratio(lms["left_eye"]) + eye_aspect_ratio(lms["right_eye"])) / 2.0
    if ear < EAR_THRESHOLD:
        blink_state["closed_frames"] = blink_state.get("closed_frames", 0) + 1
    else:
        if blink_state.get("closed_frames", 0) >= 1:
            blink_state["last_blink_time"] = now
        blink_state["closed_frames"] = 0
    return (now - blink_state.get("last_blink_time", 0)) <= LIVE_WINDOW_SEC \
           and blink_state.get("last_blink_time", 0) > 0

# ─────────────────────── ATTENDANCE SESSION STATE ────────────────────────────
attend_lock     = threading.Lock()
attendance_state = {}   # class_id → {present:[student_ids], active:bool, faculty_id:int}

def _mark_present(student_id, class_id, marked_by):
    """
    Mark a student present for TODAY in this class.
    Returns True if newly inserted, False if already marked.

    Three-layer duplicate guard:
      1. In-memory set  — fast, per-process
      2. DB pre-check   — survives server restarts
      3. INSERT OR IGNORE on UNIQUE(student_id, class_id, date) — absolute last resort
    """
    today = date.today().isoformat()

    # Layer 1 — in-memory
    with attend_lock:
        s = attendance_state.get(class_id)
        if not s or not s["active"]: return False
        if student_id in s["present"]: return False

    # Layer 2 — DB pre-check (handles re-login / server restart case)
    conn = get_db()
    try:
        already = conn.execute(
            "SELECT 1 FROM attendance WHERE student_id=? AND class_id=? AND date=?",
            (student_id, class_id, today)
        ).fetchone()
        if already:
            # Sync in-memory state so future checks are fast
            with attend_lock:
                s = attendance_state.get(class_id)
                if s and student_id not in s["present"]:
                    s["present"].append(student_id)
            return False

        # Record the precise time at the moment of marking
        now_time = datetime.now().strftime("%H:%M:%S")

        # Layer 3 — INSERT OR IGNORE (race-condition safety net)
        conn.execute(
            "INSERT OR IGNORE INTO attendance "
            "(student_id, class_id, date, time, status, marked_by) "
            "VALUES (?, ?, ?, ?, 'present', ?)",
            (student_id, class_id, today, now_time, marked_by)
        )
        inserted = conn.execute("SELECT changes()").fetchone()[0]
        conn.commit()
    finally:
        conn.close()

    if inserted:
        with attend_lock:
            s = attendance_state.get(class_id)
            if s and student_id not in s["present"]:
                s["present"].append(student_id)
        return True

    return False


def _record_faculty_verification(user_id, class_id):
    """Persist faculty verification to DB (survives server restarts)."""
    today = date.today().isoformat()
    now   = datetime.now().strftime("%H:%M:%S")
    conn  = get_db()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO faculty_verifications (user_id,class_id,date,time) "
            "VALUES(?,?,?,?)",
            (user_id, class_id, today, now)
        )
        conn.commit()
    finally:
        conn.close()


def _faculty_verified_today(user_id, class_id):
    """Return True if this faculty already verified for this class today."""
    today = date.today().isoformat()
    conn  = get_db()
    row   = conn.execute(
        "SELECT 1 FROM faculty_verifications WHERE user_id=? AND class_id=? AND date=?",
        (user_id, class_id, today)
    ).fetchone()
    conn.close()
    return row is not None

# ─────────────────────── HELPER ──────────────────────────────────────────────
def save_image_as_jpeg(src, dest_path):
    """Save any image source (file-like or bytes) as a proper RGB JPEG."""
    if hasattr(src, 'read'):
        img = PILImage.open(src)
    elif isinstance(src, (bytes, bytearray)):
        img = PILImage.open(io.BytesIO(src))
    else:
        img = PILImage.open(src)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(dest_path, "JPEG", quality=95)

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT

def row_to_dict(row):
    return dict(row) if row else None

# ─────────────────────── AUTH ROUTES ─────────────────────────────────────────
@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    conn = get_db()
    row  = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if row and check_password_hash(row["password_hash"], password):
        user = User(row)
        login_user(user)
        return jsonify({"user": {
            "id": user.id, "username": user.username,
            "full_name": user.full_name, "role": user.role,
            "face_enrolled": bool(user.face_image_path)
        }})
    return jsonify({"error": "Invalid credentials"}), 401

@app.route("/api/auth/logout", methods=["POST"])
@login_required
def api_logout():
    logout_user()
    return jsonify({"ok": True})

@app.route("/api/me")
@login_required
def api_me():
    return jsonify({
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "face_enrolled": bool(current_user.face_image_path)
    })

# ─────────────────────── DASHBOARD ───────────────────────────────────────────
@app.route("/api/dashboard")
@login_required
def api_dashboard():
    conn = get_db()
    total_students = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
    total_classes  = conn.execute("SELECT COUNT(*) FROM classes").fetchone()[0]
    total_faculty  = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    today_count    = conn.execute(
        "SELECT COUNT(*) FROM attendance WHERE date=?", (date.today().isoformat(),)
    ).fetchone()[0]
    recent = [dict(r) for r in conn.execute(
        """SELECT a.date, a.time, s.name AS student_name, s.roll_number,
                  c.name AS class_name, c.section,
                  u.full_name AS faculty_name
           FROM attendance a
           JOIN students s ON s.id=a.student_id
           JOIN classes  c ON c.id=a.class_id
           LEFT JOIN users u ON u.id=a.marked_by
           ORDER BY a.id DESC LIMIT 10"""
    ).fetchall()]
    conn.close()
    return jsonify({
        "total_students": total_students,
        "total_classes":  total_classes,
        "total_faculty":  total_faculty,
        "today_count":    today_count,
        "recent":         recent,
    })

# ─────────────────────── USERS (super_admin) ─────────────────────────────────
@app.route("/api/users")
@login_required
@super_admin_required
def api_users_list():
    conn = get_db()
    rows = conn.execute("SELECT id,username,full_name,role,face_image_path,created_at FROM users ORDER BY id").fetchall()
    conn.close()
    return jsonify([{**dict(r), "face_enrolled": bool(r["face_image_path"])} for r in rows])

@app.route("/api/users", methods=["POST"])
@login_required
@super_admin_required
def api_users_add():
    username  = request.form.get("username", "").strip()
    full_name = request.form.get("full_name", "").strip()
    password  = request.form.get("password", "")
    role      = request.form.get("role", "faculty")
    if not username or not password:
        return jsonify({"error": "username and password required"}), 400
    if role not in ("faculty", "super_admin"):
        return jsonify({"error": "invalid role"}), 400

    face_path = None
    face_file = request.files.get("face_image")
    if face_file and face_file.filename:
        fname    = f"{uuid.uuid4().hex}.jpg"
        abs_path = os.path.join(USERS_FACES_DIR, fname)
        save_image_as_jpeg(face_file.stream, abs_path)
        face_path = str(pathlib.PurePosixPath("static") / "user_faces" / fname)

    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO users (username,full_name,password_hash,role,face_image_path) VALUES(?,?,?,?,?)",
            (username, full_name, generate_password_hash(password), role, face_path)
        )
        conn.commit()
        new_id = cur.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Username already exists"}), 409
    conn.close()
    reload_faculty_faces()
    return jsonify({"id": new_id, "username": username, "role": role}), 201

@app.route("/api/users/<int:uid>", methods=["DELETE"])
@login_required
@super_admin_required
def api_users_delete(uid):
    if uid == current_user.id:
        return jsonify({"error": "Cannot delete yourself"}), 400
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit(); conn.close()
    reload_faculty_faces()
    return jsonify({"ok": True})


@app.route("/api/users/<int:uid>")
@login_required
@super_admin_required
def api_users_get(uid):
    """Return a single user's full profile."""
    conn = get_db()
    row  = conn.execute(
        "SELECT id,username,full_name,role,face_image_path,created_at FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "User not found"}), 404
    return jsonify({**dict(row), "face_enrolled": bool(row["face_image_path"])})


@app.route("/api/users/<int:uid>", methods=["PUT"])
@login_required
@super_admin_required
def api_users_update(uid):
    """
    Update a faculty member's details.
    Accepts multipart/form-data so a new face photo can be uploaded at the same time.
    All fields are optional — only provided fields are updated.
    """
    conn = get_db()
    row  = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "User not found"}), 404

    full_name = request.form.get("full_name", "").strip() or None
    role      = request.form.get("role", "").strip()      or None
    password  = request.form.get("password", "").strip()  or None

    if role and role not in ("faculty", "super_admin"):
        conn.close()
        return jsonify({"error": "Invalid role"}), 400

    # Handle new face photo upload
    face_path = row["face_image_path"]   # keep existing unless replaced
    face_file = request.files.get("face_image")
    if face_file and face_file.filename:
        # Delete old face image if it exists
        if face_path:
            old_abs = os.path.join(os.path.dirname(__file__), face_path)
            try: os.remove(old_abs)
            except: pass
        fname    = f"{uuid.uuid4().hex}.jpg"
        abs_path = os.path.join(USERS_FACES_DIR, fname)
        save_image_as_jpeg(face_file.stream, abs_path)
        face_path = str(pathlib.PurePosixPath("static") / "user_faces" / fname)

    # Handle remove-face request (e.g. form sends remove_face=1)
    if request.form.get("remove_face") == "1" and face_path:
        old_abs = os.path.join(os.path.dirname(__file__), face_path)
        try: os.remove(old_abs)
        except: pass
        face_path = None

    # Build SET clause dynamically from provided fields
    sets, params = [], []
    if full_name is not None:
        sets.append("full_name=?");       params.append(full_name)
    if role:
        sets.append("role=?");            params.append(role)
    if password:
        sets.append("password_hash=?");   params.append(generate_password_hash(password))
    # Always update face_image_path (handles new upload or removal)
    sets.append("face_image_path=?");    params.append(face_path)

    if sets:
        params.append(uid)
        conn.execute(f"UPDATE users SET {','.join(sets)} WHERE id=?", params)
        conn.commit()

    conn.close()
    reload_faculty_faces()
    return jsonify({"ok": True})

# ─────────────────────── CLASSES ─────────────────────────────────────────────
@app.route("/api/classes")
@login_required
def api_classes_list():
    conn = get_db()
    rows = conn.execute(
        "SELECT c.id,c.name,c.section,COUNT(s.id) AS student_count "
        "FROM classes c LEFT JOIN students s ON s.class_id=c.id "
        "GROUP BY c.id ORDER BY c.id"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/classes/<int:cid>")
@login_required
def api_class_get(cid):
    conn = get_db()
    row = conn.execute("SELECT * FROM classes WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not row: return jsonify({"error": "Not found"}), 404
    return jsonify(dict(row))

@app.route("/api/classes", methods=["POST"])
@login_required
@super_admin_required
def api_classes_add():
    data = request.get_json() or {}
    name    = data.get("name", "").strip()
    section = data.get("section", "").strip()
    if not name or not section:
        return jsonify({"error": "name and section required"}), 400
    conn = get_db()
    cur  = conn.execute("INSERT INTO classes (name,section) VALUES(?,?)", (name, section))
    conn.commit(); new_id = cur.lastrowid; conn.close()
    return jsonify({"id": new_id, "name": name, "section": section}), 201

@app.route("/api/classes/<int:cid>", methods=["DELETE"])
@login_required
@super_admin_required
def api_classes_delete(cid):
    conn = get_db()
    conn.execute("DELETE FROM classes WHERE id=?", (cid,))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

# ─────────────────────── STUDENTS ────────────────────────────────────────────
@app.route("/api/students")
@login_required
def api_students_list():
    class_id = request.args.get("class_id", type=int)
    conn     = get_db()
    q = """SELECT s.*,c.name AS class_name,c.section,COUNT(sf.id) AS face_count
           FROM students s JOIN classes c ON c.id=s.class_id
           LEFT JOIN student_faces sf ON sf.student_id=s.id"""
    rows = conn.execute(
        q + (" WHERE s.class_id=? GROUP BY s.id ORDER BY s.name" if class_id else " GROUP BY s.id ORDER BY s.name"),
        (class_id,) if class_id else ()
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/students/<int:sid>")
@login_required
def api_student_get(sid):
    conn = get_db()
    s = conn.execute(
        "SELECT s.*,c.name AS class_name,c.section FROM students s "
        "JOIN classes c ON c.id=s.class_id WHERE s.id=?", (sid,)
    ).fetchone()
    if not s: conn.close(); return jsonify({"error": "Not found"}), 404
    faces = conn.execute("SELECT * FROM student_faces WHERE student_id=? ORDER BY id", (sid,)).fetchall()
    conn.close()
    return jsonify({"student": dict(s), "faces": [dict(f) for f in faces]})

@app.route("/api/students", methods=["POST"])
@login_required
def api_students_add():
    data = request.get_json() or {}
    name     = data.get("name", "").strip()
    roll     = data.get("roll_number", "").strip()
    class_id = data.get("class_id")
    if not name or not roll or not class_id:
        return jsonify({"error": "name, roll_number, class_id required"}), 400
    conn = get_db()
    cur  = conn.execute(
        "INSERT INTO students (name,roll_number,class_id) VALUES(?,?,?)",
        (name, roll, class_id)
    )
    conn.commit(); new_id = cur.lastrowid; conn.close()
    return jsonify({"id": new_id, "name": name, "roll_number": roll}), 201


@app.route("/api/students/bulk", methods=["POST"])
@login_required
@super_admin_required
def api_students_bulk():
    """
    Bulk-insert students from a JSON array.
    Body: { "students": [{"name": "...", "roll_number": "...", "class_id": 1}, ...] }

    Returns per-row result:
      inserted  – added successfully
      duplicate – roll_number already exists in that class
      error     – bad data

    Skips duplicates (same roll_number + class_id) silently.
    """
    data     = request.get_json() or {}
    rows     = data.get("students", [])
    if not rows:
        return jsonify({"error": "No students provided"}), 400
    if len(rows) > 500:
        return jsonify({"error": "Maximum 500 students per upload"}), 400

    conn      = get_db()
    inserted  = []
    duplicates = []
    errors    = []

    for i, row in enumerate(rows):
        name     = str(row.get("name",        "")).strip()
        roll     = str(row.get("roll_number", "")).strip()
        class_id = row.get("class_id")

        if not name or not roll or not class_id:
            errors.append({"row": i + 1, "reason": "Missing name, roll_number, or class_id",
                           "data": row})
            continue

        try:
            class_id = int(class_id)
        except (TypeError, ValueError):
            errors.append({"row": i + 1, "reason": "class_id must be a number", "data": row})
            continue

        # Check for duplicate roll_number in the same class
        existing = conn.execute(
            "SELECT id FROM students WHERE roll_number=? AND class_id=?",
            (roll, class_id)
        ).fetchone()
        if existing:
            duplicates.append({"row": i + 1, "roll_number": roll, "name": name})
            continue

        try:
            cur = conn.execute(
                "INSERT INTO students (name,roll_number,class_id) VALUES(?,?,?)",
                (name, roll, class_id)
            )
            inserted.append({"id": cur.lastrowid, "name": name, "roll_number": roll,
                             "class_id": class_id})
        except Exception as e:
            errors.append({"row": i + 1, "reason": str(e), "data": row})

    conn.commit()
    conn.close()

    return jsonify({
        "inserted":   len(inserted),
        "duplicates": len(duplicates),
        "errors":     len(errors),
        "inserted_students":  inserted,
        "duplicate_students": duplicates,
        "error_rows":         errors,
    }), 201

@app.route("/api/students/<int:sid>", methods=["DELETE"])
@login_required
@super_admin_required
def api_students_delete(sid):
    conn = get_db()
    conn.execute("DELETE FROM students WHERE id=?", (sid,))
    conn.commit(); conn.close()
    reload_known_faces()
    return jsonify({"ok": True})


@app.route("/api/students/<int:sid>", methods=["PUT"])
@login_required
@super_admin_required
def api_students_update(sid):
    """
    Update a student's name, roll_number, or class_id.
    All fields are optional — only provided non-empty fields are updated.
    """
    data = request.get_json() or {}
    conn = get_db()

    row = conn.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Student not found"}), 404

    name        = data.get("name",        "").strip() or None
    roll_number = data.get("roll_number", "").strip() or None
    class_id    = data.get("class_id")

    # Validate class_id if provided
    if class_id is not None:
        try:
            class_id = int(class_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"error": "class_id must be a number"}), 400
        if not conn.execute("SELECT 1 FROM classes WHERE id=?", (class_id,)).fetchone():
            conn.close()
            return jsonify({"error": "Class not found"}), 404

    # Check duplicate roll number in same class (excluding this student)
    target_class = class_id if class_id is not None else row["class_id"]
    check_roll   = roll_number if roll_number is not None else row["roll_number"]
    dup = conn.execute(
        "SELECT id FROM students WHERE roll_number=? AND class_id=? AND id!=?",
        (check_roll, target_class, sid)
    ).fetchone()
    if dup:
        conn.close()
        return jsonify({"error": f"Roll number '{check_roll}' already exists in this class"}), 409

    sets, params = [], []
    if name        is not None: sets.append("name=?");        params.append(name)
    if roll_number is not None: sets.append("roll_number=?"); params.append(roll_number)
    if class_id    is not None: sets.append("class_id=?");    params.append(class_id)

    if sets:
        params.append(sid)
        conn.execute(f"UPDATE students SET {', '.join(sets)} WHERE id=?", params)
        conn.commit()

    conn.close()
    return jsonify({"ok": True})

# ─────────────────────── STUDENT FACES ───────────────────────────────────────
@app.route("/api/students/<int:sid>/faces/upload", methods=["POST"])
@login_required
def api_faces_upload(sid):
    conn = get_db()
    if not conn.execute("SELECT 1 FROM students WHERE id=?", (sid,)).fetchone():
        conn.close(); return jsonify({"error": "Student not found"}), 404
    files    = request.files.getlist("images")
    saved    = 0
    save_dir = os.path.join(FACES_DIR, str(sid))
    os.makedirs(save_dir, exist_ok=True)
    for f in files:
        if f and f.filename and allowed_file(f.filename):
            fname    = f"{uuid.uuid4().hex}.jpg"
            abs_path = os.path.join(save_dir, fname)
            save_image_as_jpeg(f.stream, abs_path)
            rel = str(pathlib.PurePosixPath("static") / "faces" / str(sid) / fname)
            conn.execute("INSERT INTO student_faces (student_id,image_path) VALUES(?,?)", (sid, rel))
            saved += 1
    conn.commit(); conn.close()
    if saved: reload_known_faces()
    return jsonify({"saved": saved})

@app.route("/api/students/<int:sid>/faces/save_capture", methods=["POST"])
@login_required
def api_faces_capture(sid):
    data = request.get_json() or {}
    b64  = data.get("image", "")
    if not b64: return jsonify({"error": "No image"}), 400
    try:
        _, raw = b64.split(",", 1)
        img_bytes = base64.b64decode(raw)
    except Exception:
        return jsonify({"error": "Invalid base64"}), 400

    conn = get_db()
    if not conn.execute("SELECT 1 FROM students WHERE id=?", (sid,)).fetchone():
        conn.close(); return jsonify({"error": "Student not found"}), 404

    save_dir = os.path.join(FACES_DIR, str(sid))
    os.makedirs(save_dir, exist_ok=True)
    fname    = f"{uuid.uuid4().hex}.jpg"
    abs_path = os.path.join(save_dir, fname)
    save_image_as_jpeg(img_bytes, abs_path)
    rel = str(pathlib.PurePosixPath("static") / "faces" / str(sid) / fname)
    conn.execute("INSERT INTO student_faces (student_id,image_path) VALUES(?,?)", (sid, rel))
    conn.commit(); conn.close()
    reload_known_faces()
    return jsonify({"success": True})

@app.route("/api/students/<int:sid>/faces/<int:fid>", methods=["DELETE"])
@login_required
def api_faces_delete(sid, fid):
    conn = get_db()
    row  = conn.execute("SELECT * FROM student_faces WHERE id=? AND student_id=?", (fid, sid)).fetchone()
    if not row: conn.close(); return jsonify({"error": "Not found"}), 404
    path = os.path.join(os.path.dirname(__file__), row["image_path"])
    try: os.remove(path)
    except: pass
    conn.execute("DELETE FROM student_faces WHERE id=?", (fid,))
    conn.commit(); conn.close()
    reload_known_faces()
    return jsonify({"ok": True})

# ─────────────────────── ATTENDANCE SESSIONS ─────────────────────────────────
@app.route("/api/attendance/sessions", methods=["POST"])
@login_required
def api_session_start():
    global attendance_state
    data     = request.get_json() or {}
    class_id = data.get("class_id")
    if not class_id:
        return jsonify({"error": "class_id required"}), 400

    conn = get_db()
    if not conn.execute("SELECT 1 FROM classes WHERE id=?", (class_id,)).fetchone():
        conn.close(); return jsonify({"error": "Class not found"}), 404
    students = [dict(r) for r in conn.execute(
        "SELECT * FROM students WHERE class_id=? ORDER BY name", (class_id,)
    ).fetchall()]

    # Load students already marked present today (resume after crash / re-login)
    today = date.today().isoformat()
    already_present_rows = conn.execute(
        """SELECT a.student_id FROM attendance a
           WHERE a.class_id=? AND a.date=?""",
        (class_id, today)
    ).fetchall()
    already_present_ids = [r["student_id"] for r in already_present_rows]

    # Check if faculty already verified for this class today (no re-verify needed)
    already_verified = _faculty_verified_today(current_user.id, class_id)
    conn.close()

    with attend_lock:
        existing = attendance_state.get(class_id, {})
        # Merge DB-present with any in-memory present (handles mid-session start)
        merged_present = list(set(
            existing.get("present", []) + already_present_ids
        ))
        attendance_state[class_id] = {
            "present":          merged_present,
            "active":           True,
            "faculty_id":       current_user.id,
            "faculty_verified": already_verified,
            "blink_states":     existing.get("blink_states", {}),
        }

    return jsonify({
        "session_id":       class_id,
        "class_id":         class_id,
        "students":         students,
        "faculty_enrolled": bool(current_user.face_image_path),
        # Tell the frontend whether to skip faculty verify step
        "faculty_already_verified": already_verified,
        # Return who is already present so UI can show them immediately
        "already_present_count": len(already_present_ids),
    })

@app.route("/api/attendance/sessions/<int:class_id>/stop", methods=["POST"])
@login_required
def api_session_stop(class_id):
    with attend_lock:
        if class_id in attendance_state:
            attendance_state[class_id]["active"] = False
    return jsonify({"ok": True})

@app.route("/api/attendance/sessions/<int:class_id>/state")
@login_required
def api_session_state(class_id):
    """
    Returns today's attendance state for a class — used by the frontend on
    page load / re-login to resume a session without losing progress.
    Returns:
      - present: list of student records already marked today
      - pending: list of student records NOT yet marked today
      - faculty_verified: whether this faculty already verified today
      - total_students: total enrolled
    """
    today = date.today().isoformat()
    conn  = get_db()

    # All enrolled students
    all_students = [dict(r) for r in conn.execute(
        "SELECT * FROM students WHERE class_id=? ORDER BY name", (class_id,)
    ).fetchall()]

    # Already marked present today
    present_rows = conn.execute(
        """SELECT a.id AS att_id, a.time, s.id, s.name, s.roll_number
           FROM attendance a JOIN students s ON s.id=a.student_id
           WHERE a.class_id=? AND a.date=? ORDER BY a.id""",
        (class_id, today)
    ).fetchall()

    present_ids = {r["id"] for r in present_rows}
    pending = [s for s in all_students if s["id"] not in present_ids]

    already_verified = _faculty_verified_today(current_user.id, class_id)
    conn.close()

    return jsonify({
        "present":          [dict(r) for r in present_rows],
        "pending":          pending,
        "faculty_verified": already_verified,
        "total_students":   len(all_students),
        "date":             today,
    })

@app.route("/api/attendance/status/<int:class_id>")
@login_required
def api_attendance_status(class_id):
    today = date.today().isoformat()
    conn  = get_db()
    rows  = conn.execute(
        """SELECT a.id, a.time, s.id AS id, s.name, s.roll_number
           FROM attendance a JOIN students s ON s.id=a.student_id
           WHERE a.class_id=? AND a.date=? ORDER BY a.id""",
        (class_id, today)
    ).fetchall()
    # Total students for this class
    total = conn.execute(
        "SELECT COUNT(*) FROM students WHERE class_id=?", (class_id,)
    ).fetchone()[0]
    conn.close()
    return jsonify({
        "present": [dict(r) for r in rows],
        "count":   len(rows),
        "total":   total,
    })

# ─────────────────────── MULTI-FACE RECOGNITION ──────────────────────────────
# Per-person blink state (keyed by face bounding-box hash for students)
_student_blink_states: dict = {}
_faculty_blink_states: dict = {}

@app.route("/api/recognize", methods=["POST"])
@login_required
def api_recognize():
    data     = request.get_json() or {}
    b64      = data.get("image", "")
    class_id = data.get("class_id")
    mode     = data.get("mode", "students")   # "faculty" | "students"

    if not b64:
        return jsonify({"error": "No image"}), 400

    # Decode image
    try:
        _, raw    = b64.split(",", 1)
        img_bytes = base64.b64decode(raw)
        img_arr   = np.frombuffer(img_bytes, np.uint8)
        frame     = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if frame is None: raise ValueError("decode failed")
    except Exception as e:
        return jsonify({"error": f"Invalid image: {e}"}), 400

    # Resize for speed — keep small to reduce face_locations time
    small = cv2.resize(frame, (0, 0), fx=SCALE, fy=SCALE)
    rgb   = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    rgb   = np.ascontiguousarray(rgb, dtype=np.uint8)

    try:
        # number_of_times_to_upsample=0 skips upsampling — much faster, fine for close-up faces
        locations = face_recognition.face_locations(rgb, number_of_times_to_upsample=0, model="hog")
    except Exception:
        locations = []

    if not locations:
        return jsonify({"faces": [], "face_count": 0})

    # Get all landmarks for liveness (only called if faces were found)
    try:
        all_lms = face_recognition.face_landmarks(rgb, locations)
    except Exception:
        all_lms = [None] * len(locations)

    # Get all encodings — num_jitters=1 is accurate enough, already default
    try:
        all_encs = face_recognition.face_encodings(rgb, locations, num_jitters=1)
    except Exception:
        all_encs = [None] * len(locations)

    results = []

    if mode == "faculty":
        # Verify the faculty member who started this session
        with faces_lock:
            fac_encs  = list(faculty_encodings)
            fac_ids   = list(faculty_user_ids)
            fac_names = dict(faculty_names)

        # Ensure current user's face is actually enrolled
        if current_user.id not in fac_ids:
            return jsonify({
                "faces": [{"name": current_user.full_name or current_user.username,
                           "decision": "NOT_ENROLLED",
                           "box": None}],
                "face_count": 0,
                "error": "Your face photo is not enrolled. Ask an admin to add it in your profile."
            })

        for i, (loc, lms, enc) in enumerate(zip(locations, all_lms, all_encs)):
            t, r, b, l = [int(v / SCALE) for v in loc]
            box = [t, r, b, l]
            face_key = f"{t//40}_{l//40}"   # rough grid key for blink state continuity

            liveness = False
            if lms:
                bstate = _faculty_blink_states.setdefault(face_key, {"closed_frames": 0, "last_blink_time": 0})
                liveness = check_liveness(lms, bstate)

            if enc is None or not fac_encs:
                results.append({"name": "Unknown", "decision": "DENIED", "box": box})
                continue

            dist_arr = face_recognition.face_distance(fac_encs, enc)
            best     = int(np.argmin(dist_arr))

            # Use a slightly more lenient tolerance for mobile cameras
            FACULTY_TOLERANCE = 0.62

            # Only match against the current user's own enrolled face(s)
            if dist_arr[best] <= FACULTY_TOLERANCE and fac_ids[best] == current_user.id:
                name = fac_names.get(fac_ids[best], current_user.full_name or current_user.username)
                if liveness:
                    # Mark session as faculty-verified in memory AND persist to DB
                    if class_id:
                        with attend_lock:
                            s = attendance_state.get(class_id)
                            if s: s["faculty_verified"] = True
                        # Persist so a re-login skips re-verification
                        _record_faculty_verification(current_user.id, class_id)
                    results.append({"name": name, "decision": "FACULTY_VERIFIED", "box": box,
                                    "user_id": fac_ids[best]})
                else:
                    results.append({"name": name, "decision": "SPOOF", "box": box})
            elif fac_ids[best] == current_user.id and dist_arr[best] <= FACULTY_TOLERANCE + 0.08:
                # Face is recognized as the right person but distance is borderline —
                # give useful feedback instead of DENIED
                name = fac_names.get(fac_ids[best], current_user.full_name or current_user.username)
                results.append({"name": name, "decision": "SPOOF", "box": box})
            else:
                results.append({"name": "Unknown", "decision": "DENIED", "box": box})

    else:  # students mode
        with faces_lock:
            stu_encs  = list(known_encodings)
            stu_ids   = list(known_student_ids)
            stu_names = dict(known_names)

        for i, (loc, lms, enc) in enumerate(zip(locations, all_lms, all_encs)):
            t, r, b, l = [int(v / SCALE) for v in loc]
            box = [t, r, b, l]
            face_key = f"{t//40}_{l//40}"

            liveness = False
            if lms:
                bstate = _student_blink_states.setdefault(face_key, {"closed_frames": 0, "last_blink_time": 0})
                liveness = check_liveness(lms, bstate)

            if enc is None or not stu_encs:
                results.append({"name": "Unknown", "decision": "DENIED", "box": box})
                continue

            dist_arr = face_recognition.face_distance(stu_encs, enc)
            best     = int(np.argmin(dist_arr))

            if dist_arr[best] <= MATCH_TOLERANCE:
                sid  = stu_ids[best]
                name = stu_names.get(sid, "Unknown")
                if liveness:
                    if class_id:
                        marked = _mark_present(sid, class_id, current_user.id)
                        decision = "GRANTED"
                    else:
                        decision = "GRANTED"
                    results.append({"name": name, "decision": decision,
                                    "student_id": sid, "box": box})
                else:
                    results.append({"name": name, "decision": "SPOOF", "box": box})
            else:
                results.append({"name": "Unknown", "decision": "DENIED", "box": box})

    return jsonify({"faces": results, "face_count": len(results)})

# ─────────────────────── REPORTS ─────────────────────────────────────────────
def _attendance_query(class_id=None, date_from=None, date_to=None, faculty_id=None):
    clauses, params = [], []
    if class_id:   clauses.append("a.class_id=?");      params.append(class_id)
    if date_from:  clauses.append("a.date>=?");          params.append(date_from)
    if date_to:    clauses.append("a.date<=?");          params.append(date_to)
    if faculty_id: clauses.append("a.marked_by=?");      params.append(faculty_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT a.date, a.time, s.name AS student_name, s.roll_number,
               c.name AS class_name, c.section, a.status,
               u.full_name AS faculty_name, u.username AS faculty_username
        FROM attendance a
        JOIN students s ON s.id=a.student_id
        JOIN classes  c ON c.id=a.class_id
        LEFT JOIN users u ON u.id=a.marked_by
        {where}
        ORDER BY a.date DESC, a.time DESC
    """
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ─────────────────────── FACULTY VERIFICATION LOG (super_admin only) ─────────
@app.route("/api/faculty/verifications")
@login_required
@super_admin_required
def api_faculty_verifications():
    """List of all faculty session verifications — super_admin eyes only."""
    date_from  = request.args.get("date_from")
    date_to    = request.args.get("date_to")
    class_id   = request.args.get("class_id", type=int)

    clauses, params = [], []
    if date_from: clauses.append("fv.date >= ?"); params.append(date_from)
    if date_to:   clauses.append("fv.date <= ?"); params.append(date_to)
    if class_id:  clauses.append("fv.class_id = ?"); params.append(class_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    sql = f"""
        SELECT fv.id, fv.date, fv.time,
               u.full_name AS faculty_name, u.username,
               c.name AS class_name, c.section
        FROM faculty_verifications fv
        JOIN users u ON u.id = fv.user_id
        JOIN classes c ON c.id = fv.class_id
        {where}
        ORDER BY fv.date DESC, fv.time DESC
    """
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify({"verifications": [dict(r) for r in rows]})


# ─────────────────────── ATTENDANCE PERCENTAGE ───────────────────────────────
@app.route("/api/attendance/percentage")
@login_required
def api_attendance_percentage():
    """
    Returns attendance percentage for every student.
    Logic: for each class a student belongs to, count the unique session-dates
    that class had (= total conducted), and count how many of those the student
    attended.  75% is the standard minimum threshold.

    Query params (all optional):
      class_id   – filter to one class
      student_id – filter to one student
    """
    class_id   = request.args.get("class_id",   type=int)
    student_id = request.args.get("student_id", type=int)

    conn = get_db()

    # Total sessions held per class = distinct dates that any attendance was
    # recorded for that class (each faculty session covers one date).
    sessions_sql = """
        SELECT class_id, COUNT(DISTINCT date) AS total_sessions
        FROM attendance
        GROUP BY class_id
    """
    sessions_map = {r["class_id"]: r["total_sessions"]
                    for r in conn.execute(sessions_sql).fetchall()}

    # Build student list
    clauses, params = [], []
    if class_id:
        clauses.append("s.class_id = ?"); params.append(class_id)
    if student_id:
        clauses.append("s.id = ?"); params.append(student_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    students_sql = f"""
        SELECT s.id, s.name, s.roll_number,
               c.id AS class_id, c.name AS class_name, c.section
        FROM students s
        JOIN classes c ON c.id = s.class_id
        {where}
        ORDER BY c.name, c.section, s.name
    """
    students = conn.execute(students_sql, params).fetchall()

    results = []
    for st in students:
        sid  = st["id"]
        cid  = st["class_id"]
        total = sessions_map.get(cid, 0)

        # Days the student was actually present
        attended = conn.execute(
            "SELECT COUNT(DISTINCT date) FROM attendance "
            "WHERE student_id=? AND class_id=?",
            (sid, cid)
        ).fetchone()[0]

        pct = round((attended / total * 100), 1) if total > 0 else None

        results.append({
            "student_id":   sid,
            "name":         st["name"],
            "roll_number":  st["roll_number"],
            "class_id":     cid,
            "class_name":   st["class_name"],
            "section":      st["section"],
            "total_sessions": total,
            "attended":     attended,
            "percentage":   pct,
            "status":       (
                "No Data"  if pct is None else
                "Critical" if pct < 65   else
                "Low"      if pct < 75   else
                "Good"
            ),
        })

    conn.close()
    return jsonify({"students": results})


@app.route("/api/attendance/report")
@login_required
def api_attendance_report():
    class_id   = request.args.get("class_id", type=int)
    date_from  = request.args.get("date_from")
    date_to    = request.args.get("date_to")
    # Faculty only see their own sessions; super_admin can filter by any faculty
    faculty_id = None
    if current_user.role == "super_admin":
        faculty_id = request.args.get("faculty_id", type=int)
    else:
        # Faculty see ALL student records for classes they took (not filtered by faculty_id)
        # — they see student names/times but NOT other faculty info
        pass
    records = _attendance_query(class_id, date_from, date_to, faculty_id)
    # Strip faculty identity from records returned to non-admin users
    if current_user.role != "super_admin":
        for r in records:
            r.pop("faculty_name", None)
            r.pop("faculty_username", None)
    return jsonify({"records": records})

@app.route("/api/attendance/export/csv")
@login_required
def api_export_csv():
    class_id   = request.args.get("class_id", type=int)
    date_from  = request.args.get("date_from")
    date_to    = request.args.get("date_to")
    faculty_id = request.args.get("faculty_id", type=int) if current_user.role == "super_admin" else None
    records    = _attendance_query(class_id, date_from, date_to, faculty_id)
    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(["Date","Time","Student","Roll No","Class","Section","Faculty","Status"])
    for r in records:
        w.writerow([r["date"], r["time"], r["student_name"], r["roll_number"],
                    r["class_name"], r["section"],
                    r.get("faculty_name") or r.get("faculty_username") or "",
                    r["status"]])
    buf.seek(0)
    return send_file(io.BytesIO(buf.getvalue().encode()),
                     mimetype="text/csv",
                     download_name="attendance.csv",
                     as_attachment=True)

@app.route("/api/attendance/export/pdf")
@login_required
def api_export_pdf():
    class_id   = request.args.get("class_id", type=int)
    date_from  = request.args.get("date_from")
    date_to    = request.args.get("date_to")
    faculty_id = request.args.get("faculty_id", type=int) if current_user.role == "super_admin" else None
    records    = _attendance_query(class_id, date_from, date_to, faculty_id)

    buf  = io.BytesIO()
    doc  = SimpleDocTemplate(buf, pagesize=A4)
    ss   = getSampleStyleSheet()
    rows = [["Date","Time","Student","Roll","Class","Section","Faculty"]]
    for r in records:
        rows.append([r["date"], r["time"], r["student_name"], r["roll_number"],
                     r["class_name"], r["section"],
                     r.get("faculty_name") or r.get("faculty_username") or ""])
    t = Table(rows)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), rl_colors.HexColor("#1e3a8a")),
        ("TEXTCOLOR",  (0,0), (-1,0), rl_colors.white),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",   (0,0), (-1,-1), 8),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [rl_colors.white, rl_colors.HexColor("#f0f4ff")]),
        ("GRID",       (0,0), (-1,-1), 0.3, rl_colors.grey),
        ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
        ("PADDING",    (0,0), (-1,-1), 4),
    ]))
    doc.build([Paragraph("Attendance Report", ss["Title"]), t])
    buf.seek(0)
    return send_file(buf, mimetype="application/pdf",
                     download_name="attendance.pdf", as_attachment=True)

# ─────────────────────── SERVE REACT ─────────────────────────────────────────
REACT_BUILD = os.path.join(os.path.dirname(__file__), "static", "react")

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    # Serve static assets from the React build
    full = os.path.join(REACT_BUILD, path)
    if path and os.path.isfile(full):
        return send_from_directory(REACT_BUILD, path)
    # All other routes → index.html (React Router handles it)
    index = os.path.join(REACT_BUILD, "index.html")
    if os.path.isfile(index):
        return send_from_directory(REACT_BUILD, "index.html")
    return jsonify({"error": "React build not found. Run: cd frontend && npm run build"}), 404

# ─────────────────────── MAIN ────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    reload_known_faces()
    reload_faculty_faces()

    # Use HTTPS if cert.pem and key.pem exist (required for mobile camera access)
    _cert = os.path.join(os.path.dirname(__file__), "cert.pem")
    _key  = os.path.join(os.path.dirname(__file__), "key.pem")
    if os.path.exists(_cert) and os.path.exists(_key):
        print("[SSL] Starting with HTTPS on port 5443  (threaded mode)")
        print("[SSL] Open on this device:  https://127.0.0.1:5443")
        print("[SSL] Open on mobile/LAN:   https://10.221.138.1:5443")
        print("[SSL] First visit: browser will warn 'Not secure' — click Advanced → Proceed")
        app.run(host="0.0.0.0", port=5443, debug=False,
                threaded=True,        # handle each request in its own thread
                ssl_context=(_cert, _key))
    else:
        print("[HTTP] No certificates found. Camera will NOT work on mobile.")
        print("[HTTP] Running on http://0.0.0.0:5000")
        app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
