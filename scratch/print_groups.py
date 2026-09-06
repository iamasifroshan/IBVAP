import json
from collections import defaultdict

with open('scratch/incidents_inventory.json') as f:
    items = json.load(f)

by_cam_track = defaultdict(list)
for item in items:
    by_cam_track[(item['camera_id'], item['track_id'])].append(item)

print('=== GROUPS WITH > 1 INCIDENT ===')
for (cam, trk), inc_list in sorted(by_cam_track.items(), key=lambda x: -len(x[1])):
    if len(inc_list) > 1:
        print(f"\n{cam} | {trk} -> {len(inc_list)} incidents:")
        for i in inc_list:
            print(f"   {i['incident_id']} | {i['timestamp']} | {i['event_type']} | Snap: {i['snapshot_url']} | HasFile: {i['has_physical_evidence']}")
