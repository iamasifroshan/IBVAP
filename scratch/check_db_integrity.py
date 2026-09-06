import sqlite3

conn = sqlite3.connect('backend/ibvap.db')
cur = conn.cursor()
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
print("DATABASE TABLE COUNTS:")
for t in sorted(tables):
    count = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {count}")
conn.close()
