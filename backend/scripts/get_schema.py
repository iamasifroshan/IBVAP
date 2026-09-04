import sqlite3

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()
c.execute("SELECT sql FROM sqlite_master WHERE type='table'")
for row in c.fetchall():
    if row[0]:
        print(row[0])
conn.close()
