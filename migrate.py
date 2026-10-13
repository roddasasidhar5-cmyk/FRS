import sqlite3

conn = sqlite3.connect("attendance.db")

# Add new columns to users (ignore if already exist)
for col in [
    "ALTER TABLE users ADD COLUMN full_name TEXT",
    "ALTER TABLE users ADD COLUMN face_image_path TEXT",
]:
    try:
        conn.execute(col)
        print(f"Added: {col}")
    except sqlite3.OperationalError as e:
        print(f"Skip (already exists): {e}")

# Update roles: admin → super_admin, teacher → faculty
conn.execute("UPDATE users SET role='super_admin' WHERE role='admin'")
conn.execute("UPDATE users SET role='faculty' WHERE role='teacher'")
conn.commit()
conn.close()
print("Migration complete.")
