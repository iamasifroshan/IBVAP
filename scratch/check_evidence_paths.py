import sqlite3
import os

conn = sqlite3.connect('backend/ibvap.db')
cur = conn.cursor()

cur.execute("SELECT count(*), count(snapshot_url) FROM incidents")
print('Incidents total:', cur.fetchone())

cur.execute("SELECT DISTINCT snapshot_url FROM incidents WHERE snapshot_url IS NOT NULL AND snapshot_url != ''")
snapshot_urls = [r[0] for r in cur.fetchall()]
print(f'Distinct snapshot_urls in incidents: {len(snapshot_urls)}')

backend_dir = os.path.abspath('backend/storage/evidence')
public_dir = os.path.abspath('public/storage/evidence')

found_in_backend = 0
found_in_public = 0
not_found_anywhere = []

for u in snapshot_urls:
    fname = os.path.basename(u)
    b_path = os.path.join(backend_dir, fname)
    p_path = os.path.join(public_dir, fname)
    if os.path.exists(b_path):
        found_in_backend += 1
    elif os.path.exists(p_path):
        found_in_public += 1
    else:
        not_found_anywhere.append((u, fname))

print(f'Found in backend/storage/evidence: {found_in_backend}')
print(f'Found in public/storage/evidence: {found_in_public}')
print(f'Not found anywhere: {len(not_found_anywhere)}')
if not_found_anywhere:
    print('Sample not found (first 10):', not_found_anywhere[:10])

print("\n--- CHECKING EVIDENCE TABLE ---")
cur.execute("SELECT id, incident_id, file_path FROM evidence")
evidence_rows = cur.fetchall()
print(f"Total rows in evidence table: {len(evidence_rows)}")
ev_found_exact = 0
ev_found_basename_backend = 0
ev_found_basename_public = 0
ev_not_found = []

for eid, inc_id, fpath in evidence_rows:
    if fpath and os.path.exists(fpath):
        ev_found_exact += 1
    elif fpath:
        fname = os.path.basename(fpath)
        if os.path.exists(os.path.join(backend_dir, fname)):
            ev_found_basename_backend += 1
        elif os.path.exists(os.path.join(public_dir, fname)):
            ev_found_basename_public += 1
        else:
            ev_not_found.append((eid, inc_id, fpath))
    else:
        ev_not_found.append((eid, inc_id, fpath))

print(f"Evidence exact path exists: {ev_found_exact}")
print(f"Evidence basename in backend/storage/evidence: {ev_found_basename_backend}")
print(f"Evidence basename in public/storage/evidence: {ev_found_basename_public}")
print(f"Evidence not found anywhere: {len(ev_not_found)}")
if ev_not_found:
    print("Sample evidence not found:", ev_not_found[:5])
