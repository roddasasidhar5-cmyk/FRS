"""Quick database inspector — run: python inspect_db.py"""
import sqlite3, os

DB = os.path.join(os.path.dirname(__file__), "attendance.db")
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

tables = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).fetchall()]

print("=" * 60)
print("  DATABASE:", DB)
print("=" * 60)
print()

# Row counts
print("TABLE SUMMARY")
print("-" * 30)
for t in tables:
    count = conn.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  {t:<35} {count:>5} rows")

print()

# Full contents
for t in tables:
    rows = conn.execute(f"SELECT * FROM [{t}]").fetchall()
    print(f"{'=' * 60}")
    print(f"  TABLE: {t}  ({len(rows)} rows)")
    print(f"{'=' * 60}")
    if not rows:
        print("  (empty)\n")
        continue
    cols = rows[0].keys()
    col_widths = {c: max(len(str(c)), max(len(str(r[c])) for r in rows)) for c in cols}
    col_widths = {c: min(w, 30) for c, w in col_widths.items()}  # cap at 30
    header = " | ".join(str(c).ljust(col_widths[c]) for c in cols)
    sep    = "-+-".join("-" * col_widths[c] for c in cols)
    print(header)
    print(sep)
    for r in rows:
        line = " | ".join(str(r[c])[:col_widths[c]].ljust(col_widths[c]) for c in cols)
        print(line)
    print()

conn.close()
