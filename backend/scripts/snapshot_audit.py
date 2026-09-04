"""
Deep audit: check snapshot_url field of incidents — this is what the UI displays.
Some incidents have snapshot_url pointing to the evidence storage path.
We need to inspect these images to find cloud/background-only images.
"""
import sqlite3, os, sys

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()

# Get all incidents that have a snapshot_url pointing to a real file
c.execute("""
    SELECT incident_id, camera_id, track_id, snapshot_url, timestamp, threat_score, threat_level, person_name
    FROM incidents
    WHERE snapshot_url IS NOT NULL AND snapshot_url != ''
    ORDER BY camera_id, timestamp
""")
rows = c.fetchall()
print(f"Incidents with snapshot_url: {len(rows)}")
print()

for inc_id, cam, track, snap_url, ts, threat, tlevel, pname in rows:
    # Try multiple path resolutions
    candidates = [
        snap_url,  # direct
        os.path.join('backend', 'storage', 'evidence', os.path.basename(snap_url)),
        os.path.join('backend') + snap_url if snap_url.startswith('/') else None,
        'backend' + snap_url if snap_url.startswith('/') else None,
    ]
    found_path = None
    for cand in candidates:
        if cand and os.path.exists(cand):
            found_path = cand
            break
    
    size = os.path.getsize(found_path) if found_path else 0
    print(f"{inc_id} | {cam} | {track} | {pname} | {threat}/{tlevel}")
    print(f"  url: {snap_url}")
    print(f"  resolved: {found_path} | size: {size}B")
    print()

conn.close()
