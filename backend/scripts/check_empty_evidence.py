import sqlite3

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()

# 1. Find all incidents with empty snapshot_urls
c.execute("SELECT incident_id FROM incidents WHERE snapshot_url = '' OR snapshot_url IS NULL")
empty_snapshot_incidents = [row[0] for row in c.fetchall()]

print(f"Found {len(empty_snapshot_incidents)} incidents with empty snapshot URLs.")

# 2. Check if they have evidence
placeholders = ','.join(['?'] * len(empty_snapshot_incidents))
if placeholders:
    c.execute(f"SELECT file_path FROM evidence WHERE incident_id IN ({placeholders})", empty_snapshot_incidents)
    evidence_for_empty = c.fetchall()
    print(f"Found {len(evidence_for_empty)} evidence records for these incidents.")
else:
    print("Found 0 evidence records.")

# 3. Check if there are any incidents that HAVE a snapshot_url, but the url doesn't exist on disk?
import os
c.execute("SELECT incident_id, snapshot_url FROM incidents WHERE snapshot_url != '' AND snapshot_url IS NOT NULL")
missing_files = []
for row in c.fetchall():
    inc_id, url = row
    # URL is like /storage/evidence/webcam_evidence_30526114.jpg
    # Path is backend/storage/evidence/webcam_evidence_30526114.jpg
    path = "backend" + url
    if not os.path.exists(path):
        missing_files.append((inc_id, url))

print(f"Found {len(missing_files)} incidents whose snapshot_url does not exist on disk.")

conn.close()
