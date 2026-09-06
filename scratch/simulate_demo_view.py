import sys
import os
import json
from collections import defaultdict

sys.path.insert(0, 'backend')
from database.db import SessionLocal
from database.models import (
    IncidentModel, EvidenceModel, SecurityEventModel,
    SuspiciousActivityModel, NightMovementModel
)

db = SessionLocal()
incidents = db.query(IncidentModel).order_by(IncidentModel.timestamp.desc()).all()
evidence = db.query(EvidenceModel).all()

ev_dir = os.path.join('backend', 'storage', 'evidence')
pub_ev_dir = os.path.join('public', 'storage', 'evidence')

def has_file(fname):
    if not fname: return False
    b = os.path.basename(fname)
    return os.path.exists(os.path.join(ev_dir, b)) or os.path.exists(os.path.join(pub_ev_dir, b))

# Get all incidents that have physical evidence
inc_with_file = []
for inc in incidents:
    snap = inc.snapshot_url
    ev_records = db.query(EvidenceModel).filter(
        (EvidenceModel.incident_id == inc.incident_id) | (EvidenceModel.incident_id == inc.id)
    ).all()
    all_files = [os.path.basename(e.file_path) for e in ev_records]
    if snap:
        all_files.append(os.path.basename(snap))
    
    existing_files = [f for f in set(all_files) if has_file(f)]
    if existing_files:
        inc_with_file.append((inc, existing_files))

print(f"Total incidents with retrievable physical evidence: {len(inc_with_file)}")
print("\nUnique episodes (deduplicated by camera + track + 10-min window):")

seen_episodes = set()
demo_incidents = []
duplicates_to_merge = []

for inc, files in inc_with_file:
    # Episode key: (camera_id, track_id, date, hour_block)
    ts = inc.timestamp
    date_str = ts.strftime("%Y-%m-%d") if ts else "nodate"
    hour_block = ts.hour if ts else 0
    # Group within 1-hour window for same camera + track
    ep_key = (inc.camera_id, inc.track_id, date_str, hour_block, inc.event_type)
    
    if ep_key not in seen_episodes:
        seen_episodes.add(ep_key)
        demo_incidents.append((inc, files))
    else:
        duplicates_to_merge.append((inc, files, ep_key))

print(f"Genuine Primary Demo Incidents: {len(demo_incidents)}")
print(f"Duplicates with evidence to merge into primary: {len(duplicates_to_merge)}")

print("\n--- DEMO INCIDENTS LIST ---")
for inc, files in demo_incidents:
    print(f"  {inc.incident_id} | {inc.event_type:35} | {inc.camera_id:15} | {inc.track_id:8} | Score: {inc.threat_score:2} | Files: {files}")
