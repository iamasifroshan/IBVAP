import json
from collections import defaultdict
from datetime import datetime

with open('scratch/incidents_inventory.json') as f:
    items = json.load(f)

breaches = [i for i in items if i['event_type'] == 'RESTRICTED_ZONE_BREACH']
print(f"Total RESTRICTED_ZONE_BREACH incidents: {len(breaches)}")

with_phys = [i for i in breaches if i['has_physical_evidence']]
missing_ev = [i for i in breaches if i['snapshot_url'] and not i['has_physical_evidence']]
no_snap = [i for i in breaches if not i['snapshot_url']]

print(f"  With physical evidence file: {len(with_phys)}")
print(f"  Snapshot URL set, but file missing on disk: {len(missing_ev)}")
print(f"  No snapshot URL set (empty): {len(no_snap)}")

print("\n--- Incidents with physical evidence ---")
for i in with_phys:
    print(f"  {i['incident_id']} | Cam: {i['camera_id']} | Track: {i['track_id']} | Time: {i['timestamp']} | Snap: {i['snapshot_url']}")

print("\n--- Incidents with MISSING evidence file (first 10) ---")
for i in missing_ev[:10]:
    print(f"  {i['incident_id']} | Cam: {i['camera_id']} | Track: {i['track_id']} | Time: {i['timestamp']} | Snap: {i['snapshot_url']}")

print("\n--- Incidents with NO snapshot URL (first 10) ---")
for i in no_snap[:10]:
    print(f"  {i['incident_id']} | Cam: {i['camera_id']} | Track: {i['track_id']} | Time: {i['timestamp']} | Reason: {i['explainable_reason'][:50]}")
