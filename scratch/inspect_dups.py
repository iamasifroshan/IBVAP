import json

with open("scratch/classification_result.json") as f:
    res = json.load(f)

dups = res["C_DUPLICATE"]
print(f"Total in C_DUPLICATE: {len(dups)}")
for d in dups:
    print(f"  DUP: {d['incident_id']} -> PRIMARY: {d.get('duplicate_of')} | Cam: {d['camera_id']} | Track: {d['track_id']} | Time: {d['timestamp']} | HasFile: {d['has_physical_evidence']} | EvFiles: {d['ev_files']}")
