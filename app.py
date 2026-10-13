# pip install flask flask-login werkzeug face-recognition opencv-python dlib numpy reportlab
"""
Face Recognition Attendance System
Multi-class, multi-role (admin / teacher) attendance management.
Run:  python app.py
Open: http://0.0.0.0:5000
"""

import os
import time
import threading
import csv
import io
import uuid
from math import dist
from datetime import date, datetime
import sqlite3
import base64

import pathlib

import cv2
import numpy as np
import face_recognition
from flask import (
    Flask, Response, jsonify, render_template, redirect,
    url_for, request, flash, send_file, abort, session
)
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

# ─────────────────────────── CONFIG ─────────────────────────────────────────
CAMERA_INDEX      = int(os.getenv("CAMERA_INDEX", 0))
KNOWN_DIR         = os.getenv("KNOWN_DIR", "known_faces")   # legacy, kept for compat
SERIAL_PORT       = os.getenv("DE10_SERIAL", "")
SERIAL_BAUD       = int(os.getenv("DE10_BAUD", 115200))

MATCH_TOLERANCE   = 0.58   # raised from 0.50 → more lenient matching (library default is 0.60)
EAR_THRESHOLD     = 0.21
EAR_CONSEC_FRAMES = 1      # lowered from 2 → catches fast single-frame blinks
LIVE_WINDOW_SEC   = 10.0   # raised from 6 → more time after a blink to get recognised
SCALE             = 0.75   # raised from 0.5 → better resolution for HOG detection
ENCODE_EVERY_N    = 3      # lowered from 5 → more frequent encoding checks

DB_PATH           = os.path.join(os.path.dirname(__file__), "attendance.db")
FACES_DIR         = os.path.join(os.path.dirname(__file__), "static", "faces")
ALLOWED_EXT       = {"jpg", "jpeg", "png"}

# Persist a random secret key across restarts so sessions survive server
# reboots.  The file is created once and reused forever.
# Override at any time by setting the SECRET_KEY environment variable.
_SECRET_FILE = os.path.join(os.path.dirname(__file__), ".secret_key")

def _load_secret_key() -> bytes:
    env_val = os.environ.get("SECRET_KEY", "").strip()
    if env_val:
        return env_val.encode()
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE, "rb") as _f:
            val = _f.read().strip()
            if val:
                return val
    import secrets as _secrets
    val = _secrets.token_hex(32).encode()
    with open(_SECRET_FILE, "wb") as _f:
        _f.write(val)
    return val

SECRET_KEY = _load_secret_key()

# ─────────────────────────── FLASK APP ──────────────────────────────────────
app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024   # 64 MB upload limit

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message_category = "warning"


# ─────────────────────────── USER MODEL ─────────────────────────────────────
class User(UserMixin):
    def __init__(self, id, username, password_hash, role):
        self.id = id
        self.username = username
        self.password_hash = password_hash
        self.role = role  # 'admin' | 'teacher'


@login_manager.user_loader
def load_user(user_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if row:
        return User(row["id"], row["username"], row["password_hash"], row["role"])
    return None


# ─────────────────────────── DATABASE ───────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'teacher',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            section TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            roll_number TEXT NOT NULL,
            class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS student_faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            image_path TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id),
            class_id INTEGER NOT NULL REFERENCES classes(id),
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'present',
            marked_by INTEGER REFERENCES users(id)
        )
    """)
    if not conn.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
            ("admin", generate_password_hash("admin123"), "admin")
        )
    conn.commit()
    conn.close()
    print("[DB] Initialised.")


# ─────────────────────────── SHARED STATE ───────────────────────────────────
lock        = threading.Lock()   # guards latest_jpeg + state dict
faces_lock  = threading.Lock()   # guards known_encodings / known_student_ids
attend_lock = threading.Lock()   # guards attendance_state + active_class_id

latest_jpeg = None

state = {
    "face_detected": False,
    "name": None,
    "recognized": False,
    "live": False,
    "blinks": 0,
    "ear": 0.0,
    "decision": "WAITING",
    "message": "Looking for a face...",
    "fps": 0.0,
    "student_id": None,
}

events = []

# Face encoding store (parallel lists)
known_encodings    = []   # list of np arrays
known_student_ids  = []   # list of int student_id
known_names        = {}   # student_id -> display name

# Per-class attendance session state
attendance_state  = {}   # class_id (int) -> {"present": [student_id,...], "active": bool}
active_class_id   = None  # the most recently activated class_id


def log(msg):
    stamp = time.strftime("%H:%M:%S")
    events.insert(0, f"{stamp}  {msg}")
    del events[30:]
    print(msg)


# ─────────────────────────── FACE ENCODINGS ─────────────────────────────────
def reload_known_faces():
    global known_encodings, known_student_ids, known_names
    encs, ids, names = [], [], {}
    conn = get_db()
    rows = conn.execute(
        """SELECT sf.student_id, sf.image_path, s.name
           FROM student_faces sf JOIN students s ON s.id = sf.student_id"""
    ).fetchall()
    conn.close()
    for row in rows:
        path = os.path.join(os.path.dirname(__file__), row["image_path"])
        try:
            img = face_recognition.load_image_file(path)
            enc = face_recognition.face_encodings(img)
            if enc:
                encs.append(enc[0])
                ids.append(row["student_id"])
                names[row["student_id"]] = row["name"]
            else:
                print(f"[ENROLL] WARNING: No face detected in {path} — student '{row['name']}' will NOT be recognised. Re-upload a clearer photo.")
        except Exception as e:
            print(f"[ENROLL] Failed {path}: {e}")
    with faces_lock:
        known_encodings   = encs
        known_student_ids = ids
        known_names       = names
    print(f"[ENROLL] Loaded {len(encs)} face encodings.")


# ─────────────────────────── EAR ────────────────────────────────────────────
def eye_aspect_ratio(eye):
    a = dist(eye[1], eye[5])
    b = dist(eye[2], eye[4])
    c = dist(eye[0], eye[3])
    return (a + b) / (2.0 * c) if c else 0.0


# ─────────────────────────── ATTENDANCE MARKING ─────────────────────────────
def _try_mark_attendance(student_id, class_id):
    """Mark student present if not already marked today for this class."""
    if class_id is None:
        return
    today = date.today().isoformat()
    with attend_lock:
        session_data = attendance_state.get(class_id)
        if session_data is None or not session_data.get("active"):
            return
        if student_id in session_data["present"]:
            return  # deduplicate
        session_data["present"].append(student_id)
    # Write to DB outside attend_lock to avoid holding it during I/O
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO attendance (student_id, class_id, date, time, status, marked_by)"
            " VALUES (?,?,?,?,?,?)",
            (student_id, class_id, today,
             datetime.now().strftime("%H:%M:%S"), "present", None)
        )
        conn.commit()
        conn.close()
        log(f"[ATTEND] Marked student_id={student_id} present for class_id={class_id}")
    except Exception as e:
        print(f"[ATTEND] DB write failed: {e}")


# ─────────────────────────── CAMERA LOOP ────────────────────────────────────
def camera_loop():
    global latest_jpeg

    cap = None  # opened on demand

    # Per-session state — reset each time a new session starts
    closed_frames   = 0
    blinks          = 0
    last_blink_time = 0.0
    name            = None
    recognized      = False
    matched_sid     = None
    frame_no        = 0
    t_prev          = time.time()
    last_active_cid = None  # track session changes to reset state

    while True:
        # ── Wait until an attendance session is active ──────────────────────
        with attend_lock:
            session_active = active_class_id is not None

        if not session_active:
            # Release camera when idle to free the device
            if cap is not None:
                cap.release()
                cap = None
                with lock:
                    latest_jpeg = None
            time.sleep(0.5)
            continue

        # ── Open camera on first active frame ───────────────────────────────
        if cap is None:
            cap = (cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)
                   if os.name == "nt" else cv2.VideoCapture(CAMERA_INDEX))
            if not cap.isOpened():
                cap = cv2.VideoCapture(CAMERA_INDEX)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            if not cap.isOpened():
                log("ERROR: cannot open camera")
                cap = None
                time.sleep(2)
                continue
            log("[CAMERA] Started for attendance session.")

        # Reset per-person state when a new class session starts
        with attend_lock:
            cid_now = active_class_id
        if cid_now != last_active_cid:
            closed_frames = 0; blinks = 0; last_blink_time = 0.0
            name = None; recognized = False; matched_sid = None; frame_no = 0
            last_active_cid = cid_now

        try:
            ok, frame = cap.read()
        except Exception:
            time.sleep(0.1)
            continue

        if not ok or frame is None:
            time.sleep(0.05)
            continue

        # Validate frame dimensions before passing to dlib
        if frame.ndim != 3 or frame.shape[0] < 10 or frame.shape[1] < 10:
            time.sleep(0.05)
            continue

        frame_no += 1

        try:
            small = cv2.resize(frame, (0, 0), fx=SCALE, fy=SCALE)
            rgb   = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            rgb   = np.ascontiguousarray(rgb, dtype=np.uint8)
        except Exception:
            time.sleep(0.05)
            continue

        now = time.time()
        ear = 0.0

        try:
            locations = face_recognition.face_locations(rgb, model="hog")
        except Exception:
            locations = []

        if locations:
            loc = max(locations, key=lambda l: (l[2] - l[0]) * (l[1] - l[3]))

            try:
                lms = face_recognition.face_landmarks(rgb, [loc])
            except Exception:
                lms = None
            if lms:
                try:
                    ear = (eye_aspect_ratio(lms[0]["left_eye"]) +
                           eye_aspect_ratio(lms[0]["right_eye"])) / 2.0
                    if ear < EAR_THRESHOLD:
                        closed_frames += 1
                    else:
                        if closed_frames >= EAR_CONSEC_FRAMES:
                            blinks += 1
                            last_blink_time = now
                            log("Blink detected -> person is live")
                        closed_frames = 0
                except Exception:
                    pass

            with faces_lock:
                enc_snap   = list(known_encodings)
                ids_snap   = list(known_student_ids)
                names_snap = dict(known_names)

            if frame_no % ENCODE_EVERY_N == 0 and enc_snap:
                try:
                    enc = face_recognition.face_encodings(rgb, [loc])
                except Exception:
                    enc = None
                if enc:
                    try:
                        d    = face_recognition.face_distance(enc_snap, enc[0])
                        best = int(np.argmin(d))
                        if d[best] <= MATCH_TOLERANCE:
                            matched_sid = ids_snap[best]
                            name        = names_snap.get(matched_sid, "Unknown")
                            recognized  = True
                        else:
                            matched_sid = None
                            name        = "Unknown"
                            recognized  = False
                    except Exception:
                        pass

            live = (now - last_blink_time) <= LIVE_WINDOW_SEC and last_blink_time > 0

            if recognized and live:
                decision, msg, color = "GRANTED", f"Welcome {name}", (0, 200, 0)
                with attend_lock:
                    cid = active_class_id
                if matched_sid is not None:
                    _try_mark_attendance(matched_sid, cid)
            elif recognized and not live:
                decision, msg, color = "SPOOF", "Blink to confirm you are live", (0, 165, 255)
            else:
                decision, msg, color = "DENIED", "Face not recognised", (0, 0, 255)

            try:
                t, r, b, l = [int(v / SCALE) for v in loc]
                cv2.rectangle(frame, (l, t), (r, b), color, 2)
                cv2.putText(frame, f"{name or '...'} | {decision}", (l, max(20, t - 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            except Exception:
                pass

            with lock:
                state.update(face_detected=True, name=name, recognized=recognized,
                             live=live, blinks=blinks, ear=round(ear, 3),
                             decision=decision, message=msg, student_id=matched_sid)
        else:
            closed_frames, blinks, last_blink_time = 0, 0, 0.0
            name, recognized, matched_sid = None, False, None
            with lock:
                state.update(face_detected=False, name=None, recognized=False,
                             live=False, blinks=0, ear=0.0,
                             decision="WAITING", message="Looking for a face...",
                             student_id=None)

        fps    = 1.0 / max(now - t_prev, 1e-6)
        t_prev = now
        with lock:
            state["fps"] = round(fps, 1)

        try:
            ok2, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok2:
                with lock:
                    latest_jpeg = buf.tobytes()
        except Exception:
            pass

    while True:
        try:
            ok, frame = cap.read()
        except Exception:
            time.sleep(0.1)
            continue

        if not ok or frame is None:
            time.sleep(0.05)
            continue

        # Validate frame dimensions before passing to dlib
        if frame.ndim != 3 or frame.shape[0] < 10 or frame.shape[1] < 10:
            time.sleep(0.05)
            continue

        frame_no += 1

        try:
            small = cv2.resize(frame, (0, 0), fx=SCALE, fy=SCALE)
            rgb   = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            # dlib requires a C-contiguous uint8 array — enforce this strictly
            rgb   = np.ascontiguousarray(rgb, dtype=np.uint8)
        except Exception:
            time.sleep(0.05)
            continue

        now = time.time()
        ear = 0.0

        try:
            locations = face_recognition.face_locations(rgb, model="hog")
        except Exception:
            locations = []

        if locations:
            loc = max(locations, key=lambda l: (l[2] - l[0]) * (l[1] - l[3]))

            # --- liveness: blink detection ---
            try:
                lms = face_recognition.face_landmarks(rgb, [loc])
            except Exception:
                lms = None
            if lms:
                try:
                    ear = (eye_aspect_ratio(lms[0]["left_eye"]) +
                           eye_aspect_ratio(lms[0]["right_eye"])) / 2.0
                    if ear < EAR_THRESHOLD:
                        closed_frames += 1
                    else:
                        if closed_frames >= EAR_CONSEC_FRAMES:
                            blinks += 1
                            last_blink_time = now
                            log("Blink detected -> person is live")
                        closed_frames = 0
                except Exception:
                    pass

            # --- recognition (every N frames) ---
            with faces_lock:
                enc_snap   = list(known_encodings)
                ids_snap   = list(known_student_ids)
                names_snap = dict(known_names)

            if frame_no % ENCODE_EVERY_N == 0 and enc_snap:
                try:
                    enc = face_recognition.face_encodings(rgb, [loc])
                except Exception:
                    enc = None
                if enc:
                    try:
                        d    = face_recognition.face_distance(enc_snap, enc[0])
                        best = int(np.argmin(d))
                        if d[best] <= MATCH_TOLERANCE:
                            matched_sid = ids_snap[best]
                            name        = names_snap.get(matched_sid, "Unknown")
                            recognized  = True
                        else:
                            matched_sid = None
                            name        = "Unknown"
                            recognized  = False
                    except Exception:
                        pass

            live = (now - last_blink_time) <= LIVE_WINDOW_SEC and last_blink_time > 0

            if recognized and live:
                decision, msg, color = "GRANTED", f"Welcome {name}", (0, 200, 0)
                with attend_lock:
                    cid = active_class_id
                if matched_sid is not None:
                    _try_mark_attendance(matched_sid, cid)
            elif recognized and not live:
                decision, msg, color = "SPOOF", "Face known but no blink - blink to prove you are live", (0, 165, 255)
            else:
                decision, msg, color = "DENIED", "Face not recognised", (0, 0, 255)

            # draw bounding box
            try:
                t, r, b, l = [int(v / SCALE) for v in loc]
                cv2.rectangle(frame, (l, t), (r, b), color, 2)
                cv2.putText(frame, f"{name or '...'} | {decision}", (l, max(20, t - 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            except Exception:
                pass

            with lock:
                state.update(face_detected=True, name=name, recognized=recognized,
                             live=live, blinks=blinks, ear=round(ear, 3),
                             decision=decision, message=msg, student_id=matched_sid)

            if decision != last_code:
                log(f"Decision: {decision}" + (f" ({name})" if name else ""))
                last_code = decision
        else:
            closed_frames, blinks, last_blink_time = 0, 0, 0.0
            name, recognized, matched_sid = None, False, None
            with lock:
                state.update(face_detected=False, name=None, recognized=False,
                             live=False, blinks=0, ear=0.0,
                             decision="WAITING", message="Looking for a face...",
                             student_id=None)
            last_code = None

        fps    = 1.0 / max(now - t_prev, 1e-6)
        t_prev = now
        with lock:
            state["fps"] = round(fps, 1)

        try:
            ok2, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok2:
                with lock:
                    latest_jpeg = buf.tobytes()
        except Exception:
            pass


# ─────────────────────────── MJPEG STREAM ───────────────────────────────────
def mjpeg():
    while True:
        with lock:
            jpg = latest_jpeg
        if jpg:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
        time.sleep(0.04)


@app.route("/video_feed")
@login_required
def video_feed():
    return Response(mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/snapshot")
@login_required
def snapshot():
    """Return the latest camera frame as a single JPEG (for face capture)."""
    with lock:
        jpg = latest_jpeg
    if not jpg:
        abort(503)
    return Response(jpg, mimetype="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.route("/status")
@login_required
def status():
    with lock:
        data = dict(state)
    data["events"] = events[:12]
    return jsonify(data)


# ─────────────────────────── AUTH ───────────────────────────────────────────
@app.route("/", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        conn = get_db()
        row  = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        conn.close()
        if row and check_password_hash(row["password_hash"], password):
            user = User(row["id"], row["username"], row["password_hash"], row["role"])
            login_user(user)
            return redirect(url_for("dashboard"))
        flash("Invalid credentials. Please try again.", "danger")
    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


# ─────────────────────────── ADMIN DECORATOR ────────────────────────────────
from functools import wraps

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or current_user.role != "admin":
            abort(403)
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────── DASHBOARD ──────────────────────────────────────
@app.route("/dashboard")
@login_required
def dashboard():
    conn = get_db()
    total_students = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
    total_classes  = conn.execute("SELECT COUNT(*) FROM classes").fetchone()[0]
    today_count    = conn.execute(
        "SELECT COUNT(*) FROM attendance WHERE date=?", (date.today().isoformat(),)
    ).fetchone()[0]
    recent = conn.execute(
        """SELECT a.date, a.time, s.name AS student_name, s.roll_number,
                  c.name AS class_name, c.section
           FROM attendance a
           JOIN students s ON s.id = a.student_id
           JOIN classes  c ON c.id = a.class_id
           ORDER BY a.id DESC LIMIT 10"""
    ).fetchall()
    conn.close()
    return render_template("dashboard.html",
                           total_students=total_students,
                           total_classes=total_classes,
                           today_count=today_count,
                           recent=recent)


# ─────────────────────────── CLASSES ────────────────────────────────────────
@app.route("/classes")
@login_required
def classes_list():
    conn = get_db()
    rows = conn.execute(
        """SELECT c.id, c.name, c.section,
                  COUNT(s.id) AS student_count
           FROM classes c
           LEFT JOIN students s ON s.class_id = c.id
           GROUP BY c.id ORDER BY c.id"""
    ).fetchall()
    conn.close()
    return render_template("classes/list.html", classes=rows)


@app.route("/classes/add", methods=["GET", "POST"])
@login_required
@admin_required
def classes_add():
    if request.method == "POST":
        name    = request.form.get("name", "").strip()
        section = request.form.get("section", "").strip()
        if not name or not section:
            flash("Class name and section are required.", "danger")
        else:
            conn = get_db()
            conn.execute("INSERT INTO classes (name, section) VALUES (?,?)", (name, section))
            conn.commit()
            conn.close()
            flash(f"Class '{name} / {section}' created.", "success")
            return redirect(url_for("classes_list"))
    return render_template("classes/add.html")


@app.route("/classes/<int:class_id>/delete", methods=["POST"])
@login_required
@admin_required
def classes_delete(class_id):
    conn = get_db()
    conn.execute("DELETE FROM classes WHERE id=?", (class_id,))
    conn.commit()
    conn.close()
    flash("Class deleted.", "success")
    return redirect(url_for("classes_list"))


# ─────────────────────────── STUDENTS ───────────────────────────────────────
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


@app.route("/students")
@login_required
def students_list():
    class_id = request.args.get("class_id", type=int)
    conn     = get_db()
    all_cls  = conn.execute("SELECT * FROM classes ORDER BY name").fetchall()
    if class_id:
        rows = conn.execute(
            """SELECT s.*, c.name AS class_name, c.section,
                      COUNT(sf.id) AS face_count
               FROM students s
               JOIN classes c ON c.id = s.class_id
               LEFT JOIN student_faces sf ON sf.student_id = s.id
               WHERE s.class_id=?
               GROUP BY s.id ORDER BY s.name""",
            (class_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT s.*, c.name AS class_name, c.section,
                      COUNT(sf.id) AS face_count
               FROM students s
               JOIN classes c ON c.id = s.class_id
               LEFT JOIN student_faces sf ON sf.student_id = s.id
               GROUP BY s.id ORDER BY s.name"""
        ).fetchall()
    conn.close()
    return render_template("students/list.html",
                           students=rows, classes=all_cls,
                           selected_class=class_id)


@app.route("/students/add", methods=["GET", "POST"])
@login_required
@admin_required
def students_add():
    conn    = get_db()
    classes = conn.execute("SELECT * FROM classes ORDER BY name").fetchall()
    if request.method == "POST":
        name     = request.form.get("name", "").strip()
        roll     = request.form.get("roll_number", "").strip()
        class_id = request.form.get("class_id", type=int)
        if not name or not roll or not class_id:
            flash("All fields are required.", "danger")
        else:
            cur = conn.execute(
                "INSERT INTO students (name, roll_number, class_id) VALUES (?,?,?)",
                (name, roll, class_id)
            )
            conn.commit()
            new_id = cur.lastrowid
            conn.close()
            flash(f"Student '{name}' added.", "success")
            return redirect(url_for("students_detail", student_id=new_id))
    conn.close()
    return render_template("students/add.html", classes=classes)


@app.route("/students/<int:student_id>")
@login_required
def students_detail(student_id):
    conn    = get_db()
    student = conn.execute(
        """SELECT s.*, c.name AS class_name, c.section
           FROM students s JOIN classes c ON c.id = s.class_id
           WHERE s.id=?""", (student_id,)
    ).fetchone()
    if not student:
        abort(404)
    faces = conn.execute(
        "SELECT * FROM student_faces WHERE student_id=? ORDER BY id",
        (student_id,)
    ).fetchall()
    conn.close()
    return render_template("students/detail.html", student=student, faces=faces)


@app.route("/students/<int:student_id>/delete", methods=["POST"])
@login_required
@admin_required
def students_delete(student_id):
    conn = get_db()
    conn.execute("DELETE FROM students WHERE id=?", (student_id,))
    conn.commit()
    conn.close()
    reload_known_faces()
    flash("Student deleted.", "success")
    return redirect(url_for("students_list"))


@app.route("/students/<int:student_id>/faces/upload", methods=["GET", "POST"])
@login_required
# Note: face enrollment is intentionally open to all authenticated users
# (admin and teacher alike) so teachers can enroll their own class photos.
def faces_upload(student_id):
    conn    = get_db()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        conn.close()
        abort(404)
    if request.method == "POST":
        files   = request.files.getlist("images")
        saved   = 0
        save_dir = os.path.join(FACES_DIR, str(student_id))
        os.makedirs(save_dir, exist_ok=True)
        for f in files:
            if f and f.filename and allowed_file(f.filename):
                fname    = f"{uuid.uuid4().hex}.jpg"
                abs_path = os.path.join(save_dir, fname)
                try:
                    from PIL import Image as _PILImage
                    img_pil = _PILImage.open(f.stream)
                    # Convert any mode (RGBA, P, CMYK, etc.) to plain RGB
                    if img_pil.mode != "RGB":
                        img_pil = img_pil.convert("RGB")
                    img_pil.save(abs_path, "JPEG", quality=95)
                except Exception as _e:
                    print(f"[UPLOAD] PIL conversion failed ({_e}), saving raw")
                    f.stream.seek(0)
                    f.save(abs_path)
                # Always store with forward slashes so paths work cross-platform
                rel_path = pathlib.PurePosixPath("static") / "faces" / str(student_id) / fname
                conn.execute(
                    "INSERT INTO student_faces (student_id, image_path) VALUES (?,?)",
                    (student_id, str(rel_path))
                )
                saved += 1
        conn.commit()
        conn.close()
        if saved:
            reload_known_faces()
            flash(f"{saved} image(s) uploaded successfully.", "success")
        else:
            flash("No valid images found. Upload JPG/PNG files.", "warning")
        return redirect(url_for("students_detail", student_id=student_id))
    conn.close()
    return render_template("students/detail.html",
                           student=student, faces=[], show_upload=True)


@app.route("/students/<int:student_id>/faces/capture")
@login_required
# Note: face capture is intentionally open to all authenticated users.
def faces_capture(student_id):
    conn    = get_db()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    conn.close()
    if not student:
        abort(404)
    return render_template("students/capture.html", student=student)


@app.route("/students/<int:student_id>/faces/save_capture", methods=["POST"])
@login_required
# Note: face capture save is intentionally open to all authenticated users.
def faces_save_capture(student_id):
    conn    = get_db()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        conn.close()
        return jsonify({"success": False, "error": "Student not found"}), 404
    data = request.get_json()
    if not data or "image" not in data:
        conn.close()
        return jsonify({"success": False, "error": "No image data"}), 400
    try:
        header, b64 = data["image"].split(",", 1)
        img_bytes   = base64.b64decode(b64)
        save_dir    = os.path.join(FACES_DIR, str(student_id))
        os.makedirs(save_dir, exist_ok=True)
        fname    = f"{uuid.uuid4().hex}.jpg"
        abs_path = os.path.join(save_dir, fname)
        # Convert to RGB JPEG to ensure face_recognition can read it
        try:
            from PIL import Image as _PILImage
            import io as _io
            img_pil = _PILImage.open(_io.BytesIO(img_bytes))
            if img_pil.mode != "RGB":
                img_pil = img_pil.convert("RGB")
            img_pil.save(abs_path, "JPEG", quality=95)
        except Exception as _e:
            print(f"[CAPTURE] PIL conversion failed ({_e}), saving raw")
            with open(abs_path, "wb") as fh:
                fh.write(img_bytes)
        # Always store with forward slashes so paths work cross-platform
        rel_path = pathlib.PurePosixPath("static") / "faces" / str(student_id) / fname
        conn.execute(
            "INSERT INTO student_faces (student_id, image_path) VALUES (?,?)",
            (student_id, str(rel_path))
        )
        conn.commit()
        conn.close()
        reload_known_faces()
        return jsonify({"success": True})
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 500


# ─────────────────────────── ATTENDANCE ─────────────────────────────────────
@app.route("/attendance/mark/<int:class_id>")
@login_required
# Note: teachers are intentionally allowed to start attendance sessions.
# Any authenticated user (admin or teacher) may activate a session for any class.
def attendance_mark(class_id):
    global active_class_id
    conn  = get_db()
    cls   = conn.execute("SELECT * FROM classes WHERE id=?", (class_id,)).fetchone()
    if not cls:
        conn.close()
        abort(404)
    students = conn.execute(
        "SELECT * FROM students WHERE class_id=? ORDER BY name", (class_id,)
    ).fetchall()
    conn.close()

    # Enforce one active session at a time — prevent silent session hijacking.
    with attend_lock:
        current_active = active_class_id
        already_active = (
            current_active is not None
            and current_active != class_id
            and attendance_state.get(current_active, {}).get("active", False)
        )
        if already_active:
            flash(
                f"An attendance session is already active for class ID {current_active}. "
                "Stop that session before starting a new one.",
                "danger"
            )
            return redirect(url_for("dashboard"))
        attendance_state[class_id] = {"present": [], "active": True}
        active_class_id = class_id

    return render_template("attendance/mark.html", cls=cls, students=students)


@app.route("/attendance/stop/<int:class_id>", methods=["POST"])
@login_required
def attendance_stop(class_id):
    global active_class_id
    with attend_lock:
        if class_id in attendance_state:
            attendance_state[class_id]["active"] = False
        if active_class_id == class_id:
            active_class_id = None
    flash("Attendance session ended.", "info")
    return redirect(url_for("attendance_report"))


@app.route("/attendance/status/<int:class_id>")
@login_required
def attendance_status(class_id):
    today = date.today().isoformat()
    conn  = get_db()
    rows  = conn.execute(
        """SELECT a.time, s.id AS student_id, s.name, s.roll_number
           FROM attendance a
           JOIN students s ON s.id = a.student_id
           WHERE a.class_id=? AND a.date=?
           ORDER BY a.time""",
        (class_id, today)
    ).fetchall()
    conn.close()
    present = [
        {"id": r["student_id"], "name": r["name"],
         "roll_number": r["roll_number"], "time": r["time"]}
        for r in rows
    ]
    return jsonify({"present": present, "count": len(present)})


@app.route("/attendance/report")
@login_required
def attendance_report():
    conn     = get_db()
    classes  = conn.execute("SELECT * FROM classes ORDER BY name").fetchall()
    class_id = request.args.get("class_id", type=int)
    date_from = request.args.get("date_from", "")
    date_to   = request.args.get("date_to", "")

    query  = """SELECT a.date, a.time, s.name AS student_name, s.roll_number,
                       c.name AS class_name, c.section, a.status
                FROM attendance a
                JOIN students s ON s.id = a.student_id
                JOIN classes  c ON c.id = a.class_id
                WHERE 1=1"""
    params = []
    if class_id:
        query += " AND a.class_id=?"
        params.append(class_id)
    if date_from:
        query += " AND a.date>=?"
        params.append(date_from)
    if date_to:
        query += " AND a.date<=?"
        params.append(date_to)
    query += " ORDER BY a.date DESC, a.time DESC"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return render_template("attendance/report.html",
                           records=rows, classes=classes,
                           class_id=class_id, date_from=date_from, date_to=date_to)


def _attendance_query(class_id=None, date_from="", date_to=""):
    conn  = get_db()
    query = """SELECT a.date, a.time, s.name AS student_name, s.roll_number,
                      c.name AS class_name, c.section, a.status
               FROM attendance a
               JOIN students s ON s.id = a.student_id
               JOIN classes  c ON c.id = a.class_id
               WHERE 1=1"""
    params = []
    if class_id:
        query += " AND a.class_id=?"
        params.append(class_id)
    if date_from:
        query += " AND a.date>=?"
        params.append(date_from)
    if date_to:
        query += " AND a.date<=?"
        params.append(date_to)
    query += " ORDER BY a.date DESC, a.time DESC"
    rows  = conn.execute(query, params).fetchall()
    conn.close()
    return rows


@app.route("/attendance/export/csv")
@login_required
def attendance_export_csv():
    class_id  = request.args.get("class_id", type=int)
    date_from = request.args.get("date_from", "")
    date_to   = request.args.get("date_to", "")
    rows      = _attendance_query(class_id, date_from, date_to)

    si  = io.StringIO()
    cw  = csv.writer(si)
    cw.writerow(["Student Name", "Roll Number", "Class", "Section", "Date", "Time", "Status"])
    for r in rows:
        cw.writerow([r["student_name"], r["roll_number"],
                     r["class_name"], r["section"],
                     r["date"], r["time"], r["status"]])
    output = io.BytesIO(si.getvalue().encode("utf-8"))
    output.seek(0)
    return send_file(output, mimetype="text/csv",
                     as_attachment=True,
                     download_name="attendance.csv")


@app.route("/attendance/export/pdf")
@login_required
def attendance_export_pdf():
    class_id  = request.args.get("class_id", type=int)
    date_from = request.args.get("date_from", "")
    date_to   = request.args.get("date_to", "")
    rows      = _attendance_query(class_id, date_from, date_to)

    buf    = io.BytesIO()
    doc    = SimpleDocTemplate(buf, pagesize=A4)
    styles = getSampleStyleSheet()
    elems  = [Paragraph("Attendance Report", styles["Title"])]

    data = [["Student Name", "Roll Number", "Class", "Section", "Date", "Time", "Status"]]
    for r in rows:
        data.append([r["student_name"], r["roll_number"],
                     r["class_name"], r["section"],
                     r["date"], r["time"], r["status"]])

    tbl = Table(data, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4ff")]),
        ("GRID",       (0, 0), (-1, -1), 0.4, colors.grey),
        ("ALIGN",      (0, 0), (-1, -1), "LEFT"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(tbl)
    doc.build(elems)
    buf.seek(0)
    return send_file(buf, mimetype="application/pdf",
                     as_attachment=True,
                     download_name="attendance.pdf")


# ─────────────────────────── USER MANAGEMENT ────────────────────────────────
@app.route("/users")
@login_required
@admin_required
def users_list():
    conn  = get_db()
    users = conn.execute("SELECT id, username, role, created_at FROM users ORDER BY id").fetchall()
    conn.close()
    return render_template("users/list.html", users=users)


@app.route("/users/add", methods=["GET", "POST"])
@login_required
@admin_required
def users_add():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        role     = request.form.get("role", "teacher")
        if not username or not password:
            flash("Username and password are required.", "danger")
        elif role not in ("admin", "teacher"):
            flash("Invalid role.", "danger")
        else:
            conn = get_db()
            try:
                conn.execute(
                    "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
                    (username, generate_password_hash(password), role)
                )
                conn.commit()
                flash(f"User '{username}' created.", "success")
                return redirect(url_for("users_list"))
            except sqlite3.IntegrityError:
                flash("Username already exists.", "danger")
            finally:
                conn.close()
    return render_template("users/add.html")


@app.route("/users/<int:user_id>/delete", methods=["POST"])
@login_required
@admin_required
def users_delete(user_id):
    if user_id == current_user.id:
        flash("You cannot delete your own account.", "danger")
        return redirect(url_for("users_list"))
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.commit()
    conn.close()
    flash("User deleted.", "success")
    return redirect(url_for("users_list"))


# ─────────────────────────── ENTRY POINT ────────────────────────────────────
if __name__ == "__main__":
    init_db()
    reload_known_faces()
    os.makedirs(FACES_DIR, exist_ok=True)
    threading.Thread(target=camera_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, threaded=True)
