import sqlite3, json

conn = sqlite3.connect('ibvap.db')
c = conn.cursor()

# Check orphan evidence
c.execute('SELECT COUNT(*) FROM evidence')
total_ev = c.fetchone()[0]

c.execute("SELECT COUNT(*) FROM evidence WHERE incident_id IS NULL OR incident_id = ''")
orphan_ev = c.fetchone()[0]

c.execute("SELECT COUNT(*) FROM evidence WHERE incident_id LIKE 'INC-WEBCAM-%'")
fake_ev = c.fetchone()[0]

# Check fake IDs in incidents
c.execute("SELECT COUNT(*) FROM incidents WHERE incident_id LIKE 'INC-WEBCAM-%'")
fake_inc = c.fetchone()[0]

# Check multi persons
c.execute("SELECT COUNT(*) FROM incidents WHERE event_type LIKE '%MULTIPLE%'")
multi = c.fetchone()[0]

print(f'Total evidence: {total_ev}')
print(f'Orphan evidence (null incident_id): {orphan_ev}')
print(f'Fake INC-WEBCAM evidence: {fake_ev}')
print(f'Fake INC-WEBCAM incidents: {fake_inc}')
print(f'MULTIPLE_PERSONS incidents: {multi}')

# Check the 9 deleted incidents from the backup
conn2 = sqlite3.connect('ibvap_backup.db')
c2 = conn2.cursor()
c2.execute("SELECT id, incident_id, track_id FROM incidents WHERE event_type='RESTRICTED_ZONE_BREACH'")
backup_incs = c2.fetchall()
c.execute("SELECT incident_id FROM incidents")
current_ids = set(r[0] for r in c.fetchall())
print(f'\nChecking deleted incidents from backup (total in backup: {len(backup_incs)})')
deleted = [(r[0], r[1], r[2]) for r in backup_incs if r[1] not in current_ids]
print(f'Deleted incidents: {len(deleted)}')
for db_id, inc_id, trk in deleted:
    c2.execute("SELECT bounding_box FROM detections WHERE track_id=? ORDER BY id DESC LIMIT 1", (trk.replace('TRK#', '') if trk else '',))
    row = c2.fetchone()
    if row and row[0]:
        try:
            bbox = json.loads(row[0])
            w = bbox.get('width', 0.0)
            h = bbox.get('height', 0.0)
            area = w * h
            aspect = w / h if h > 0 else 0
            print(f'  {inc_id} ({trk}): w={w:.3f}, h={h:.3f}, area={area:.4f}, aspect={aspect:.2f}')
        except:
            print(f'  {inc_id} ({trk}): bbox parse error for: {row[0]}')
    else:
        print(f'  {inc_id} ({trk}): no detection data found')

conn.close()
conn2.close()
