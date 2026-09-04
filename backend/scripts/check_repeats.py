import sqlite3

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()

c.execute("SELECT snapshot_url, COUNT(*) FROM incidents WHERE snapshot_url != '' AND snapshot_url IS NOT NULL GROUP BY snapshot_url HAVING COUNT(*) > 1")
print("Repeated snapshot_urls in incidents:")
for row in c.fetchall():
    print(row)
    
c.execute("SELECT file_path, COUNT(*) FROM evidence GROUP BY file_path HAVING COUNT(*) > 1")
print("\nRepeated file_paths in evidence:")
for row in c.fetchall():
    print(row)

conn.close()
