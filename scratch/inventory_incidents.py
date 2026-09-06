import sys
import os
import json
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, 'backend')
from database.db import SessionLocal
from database.models import (
    IncidentModel, EvidenceModel, SecurityEventModel,
    SuspiciousActivityModel, NightMovementModel, TrackModel
)

db = SessionLocal()
incidents = db.query(IncidentModel).order_by(IncidentModel.timestamp.asc()).all()
evidence = db.query(EvidenceModel).all()
sec_events = db.query(SecurityEventModel).all()
susp_acts = db.query(SuspiciousActivityModel).all()
night_movs = db.query(NightMovementModel).all()

ev_dir = os.path.join('backend', 'storage', 'evidence')
pub_ev_dir = os.path.join('public', 'storage', 'evidence')

def file_exists(fname):
    if not fname:
        return False
    b = os.path.basename(fname)
    return os.path.exists(os.path.join(ev_dir, b)) or os.path.exists(os.path.join(pub_ev_dir, b))

# Group evidence by incident_id
ev_by_inc = defaultdict(list)
for e in evidence:
    ev_by_inc[e.incident_id].append(e)

# Linked records
linked_sec = {s.track_id: s for s in sec_events}

print(f"Total Incidents: {len(incidents)}")
print(f"Total Evidence rows: {len(evidence)}")
print(f"Total Security Events: {len(sec_events)}")
print(f"Total Suspicious Activities: {len(susp_acts)}")
print(f"Total Night Movements: {len(night_movs)}")

inventory = []
for idx, inc in enumerate(incidents):
    inc_ev = ev_by_inc.get(inc.incident_id, []) + ev_by_inc.get(inc.id, [])
    # deduplicate inc_ev
    seen_ev_ids = set()
    unique_ev = []
    for e in inc_ev:
        if e.id not in seen_ev_ids:
            seen_ev_ids.add(e.id)
            unique_ev.append(e)

    ev_filenames = [os.path.basename(e.file_path) for e in unique_ev]
    if inc.snapshot_url and os.path.basename(inc.snapshot_url) not in ev_filenames:
        ev_filenames.append(os.path.basename(inc.snapshot_url))

    has_phys_evidence = any(file_exists(fn) for fn in ev_filenames)

    item = {
        "index": idx,
        "id": inc.id,
        "incident_id": inc.incident_id,
        "event_type": inc.event_type,
        "timestamp": inc.timestamp.isoformat() if inc.timestamp else None,
        "camera_id": inc.camera_id,
        "track_id": inc.track_id,
        "severity": inc.severity if hasattr(inc, 'severity') else inc.threat_level,
        "threat_score": inc.threat_score,
        "explainable_reason": inc.explainable_reason,
        "snapshot_url": inc.snapshot_url,
        "evidence_count": len(unique_ev),
        "evidence_ids": [e.id for e in unique_ev],
        "evidence_filenames": ev_filenames,
        "has_physical_evidence": has_phys_evidence,
        "source_video_ts": getattr(inc, 'source_video_timestamp_sec', None),
        "person_name": getattr(inc, 'person_name', None),
        "status": inc.status
    }
    inventory.append(item)

# Summary of patterns
types_counter = defaultdict(int)
cam_counter = defaultdict(int)
track_counter = defaultdict(int)
date_counter = defaultdict(int)
for item in inventory:
    types_counter[item["event_type"]] += 1
    cam_counter[item["camera_id"]] += 1
    track_counter[item["track_id"]] += 1
    date_str = item["timestamp"][:10] if item["timestamp"] else "None"
    date_counter[date_str] += 1

print("\n--- Event Types Breakdown ---")
for t, c in sorted(types_counter.items(), key=lambda x: -x[1]):
    print(f"  {t}: {c}")

print("\n--- Dates Breakdown ---")
for d, c in sorted(date_counter.items()):
    print(f"  {d}: {c}")

print("\n--- Cameras Breakdown ---")
for cam, c in sorted(cam_counter.items()):
    print(f"  {cam}: {c}")

with open("scratch/incidents_inventory.json", "w") as f:
    json.dump(inventory, f, indent=2)

print("\nInventory saved to scratch/incidents_inventory.json")
