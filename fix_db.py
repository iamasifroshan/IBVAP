import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', 'ibvap.db')
print(f"Updating DB at {db_path}")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("SELECT camera_id, source_url FROM cameras WHERE source_url LIKE '%(1).mp4'")
    rows = cursor.fetchall()
    print("Before update:")
    for row in rows:
        print(row)

    cursor.execute("UPDATE cameras SET source_url = REPLACE(source_url, '(1).mp4', '.mp4') WHERE source_url LIKE '%(1).mp4'")
    conn.commit()

    cursor.execute("SELECT camera_id, source_url FROM cameras WHERE source_url LIKE '%.mp4'")
    rows = cursor.fetchall()
    print("After update:")
    for row in rows:
        print(row)
except Exception as e:
    print(f"Error: {e}")

conn.close()
