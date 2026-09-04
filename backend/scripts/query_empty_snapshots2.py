import sqlite3

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()

c.execute("SELECT COUNT(*) FROM incidents")
total = c.fetchone()[0]
print(f"Total incidents: {total}")

c.execute("SELECT COUNT(*) FROM incidents WHERE snapshot_url = '' OR snapshot_url IS NULL")
empty = c.fetchone()[0]
print(f"Empty snapshot_urls: {empty}")

c.execute("SELECT incident_id, camera_id, track_id, timestamp, threat_level, threat_score FROM incidents WHERE snapshot_url = '' OR snapshot_url IS NULL LIMIT 10")
print("Incidents with empty snapshot_urls:")
for row in c.fetchall():
    print(row)

c.execute("SELECT incident_id, camera_id, track_id, snapshot_url, timestamp, person_name, threat_level, threat_score FROM incidents WHERE camera_id = 'BORDER-CAM-07' AND track_id = 'TRK#2'")
print("\nIncident for BORDER-CAM-07 TRK#2:")
for row in c.fetchall():
    print(row)

conn.close()
