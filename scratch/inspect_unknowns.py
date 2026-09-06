import json

with open("scratch/classification_result.json") as f:
    res = json.load(f)

unknowns = res["F_UNKNOWN"]
print(f"Total in F_UNKNOWN: {len(unknowns)}")
for u in unknowns[:15]:
    print(f"  {u['incident_id']} | Cam: {u['camera_id']} | Track: {u['track_id']} | Time: {u['timestamp']} | Reason: {u['reason']}")
