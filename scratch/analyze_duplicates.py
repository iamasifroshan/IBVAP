import json
from collections import defaultdict
from datetime import datetime

with open("scratch/incidents_inventory.json") as f:
    items = json.load(f)

# Group by (camera_id, track_id)
by_cam_track = defaultdict(list)
for item in items:
    key = (item["camera_id"], item["track_id"])
    by_cam_track[key].append(item)

print(f"Total Unique (camera_id, track_id) groups: {len(by_cam_track)}")
print("\nGroups with more than 1 incident (DUPLICATES / BURSTS):")
for (cam, trk), inc_list in sorted(by_cam_track.items(), key=lambda x: -len(x[1])):
    if len(inc_list) > 1:
        first_ts = inc_list[0]["timestamp"]
        last_ts = inc_list[-1]["timestamp"]
        has_phys = sum(1 for i in inc_list if i["has_physical_evidence"])
        event_types = set(i["event_type"] for i in inc_list)
        print(f"  Cam: {cam:16} | Track: {trk:10} | Incidents: {len(inc_list):3} | Phys Ev: {has_phys:2} | Types: {event_types} | Time span: {first_ts} to {last_ts}")

print("\nSingle-incident groups:")
for (cam, trk), inc_list in sorted(by_cam_track.items()):
    if len(inc_list) == 1:
        i = inc_list[0]
        print(f"  Cam: {cam:16} | Track: {trk:10} | ID: {i['incident_id']} | Type: {i['event_type']} | Has Phys Ev: {i['has_physical_evidence']} | Ts: {i['timestamp']}")
