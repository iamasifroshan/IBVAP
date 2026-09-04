import sqlite3, os

conn = sqlite3.connect('backend/ibvap.db')
c = conn.cursor()
c.execute('SELECT COUNT(*) FROM incidents'); inc_count = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM evidence'); ev_count = c.fetchone()[0]
c.execute('SELECT name FROM registered_people ORDER BY name')
persons = [r[0] for r in c.fetchall()]
c.execute('SELECT COUNT(*) FROM cameras'); cam_count = c.fetchone()[0]

print(f'INCIDENTS_BEFORE = {inc_count}')
print(f'EVIDENCE_BEFORE  = {ev_count}')
print(f'CAMERAS          = {cam_count}')
print(f'PERSONS          = {persons}')
print()

# All evidence records
c.execute('SELECT e.id, e.incident_id, e.file_path, e.evidence_type, e.created_at FROM evidence e ORDER BY e.created_at')
rows = c.fetchall()
print(f'ALL EVIDENCE RECORDS ({len(rows)}):')
for r in rows:
    ev_id, inc_id, fp, etype, cat = r
    exists = os.path.exists(fp) if fp else False
    size = os.path.getsize(fp) if exists else 0
    bname = os.path.basename(fp) if fp else "NO_PATH"
    print(f'  ev={ev_id[:12]} | inc={inc_id} | exists={exists} | size={size:>8}B | {bname}')

print()
# All incidents with snapshot_url
c.execute('SELECT incident_id, camera_id, track_id, snapshot_url, timestamp, person_name, threat_score, threat_level FROM incidents ORDER BY timestamp')
incs = c.fetchall()
print(f'ALL INCIDENTS ({len(incs)}):')
for row in incs:
    inc_id, cam, track, snap, ts, pname, threat, tlevel = row
    snap_exists = False
    if snap:
        snap_path = os.path.join('backend', 'storage', 'evidence', os.path.basename(snap)) if snap else ''
        snap_exists = os.path.exists(snap_path)
    print(f'  {inc_id} | {cam} | {track} | {pname} | {threat}/{tlevel} | snap={snap_exists} | {snap}')

conn.close()
