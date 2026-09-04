import sqlite3, json

conn = sqlite3.connect('backend/ibvap.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("""
SELECT i.incident_id, i.camera_id, i.timestamp, i.track_id, i.person_name,
       i.status, i.threat_score, i.validation_checks, i.explainable_reason
FROM incidents i
ORDER BY i.camera_id, i.timestamp
""")
rows = c.fetchall()

cam_groups = {}
for r in rows:
    cam = r['camera_id'] or 'UNKNOWN'
    cam_groups.setdefault(cam, []).append(dict(r))

for cam, incs in sorted(cam_groups.items()):
    print(f"\n=== {cam} ({len(incs)} incidents) ===")
    for inc in incs:
        try:
            vc = json.loads(inc['validation_checks']) if inc['validation_checks'] else {}
            r7 = vc.get('rule7_identity_verification', {}).get('status', '?')
            r1 = vc.get('rule1_minimum_confidence', {}).get('status', '?')
            decision = vc.get('decision', '?')
        except:
            r7 = r1 = decision = '?'
        reason = (inc['explainable_reason'] or '')[:70]
        print(f"  {inc['incident_id']} | {inc['timestamp']} | {inc['track_id']} | name={inc['person_name']} | score={inc['threat_score']} | decision={decision} | r7={r7}")
        print(f"    reason: {reason}")

conn.close()
