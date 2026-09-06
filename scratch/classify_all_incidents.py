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

# Group evidence by incident_id (both incident_id and id)
ev_by_inc = defaultdict(list)
for e in evidence:
    ev_by_inc[e.incident_id].append(e)

# Links from secondary tables
susp_by_inc = {sa.incident_id: sa for sa in susp_acts if sa.incident_id}
night_by_inc = {nm.incident_id: nm for nm in night_movs if nm.incident_id}
sec_by_inc = set()
for se in sec_events:
    for rel_id in (se.related_incident_ids or []):
        sec_by_inc.add(rel_id)

classification = {
    "A_GENUINE_VALID_EVIDENCE": [],
    "B_GENUINE_MISSING_EVIDENCE": [],
    "C_DUPLICATE": [],
    "D_TEST_SYNTHETIC_FAKE": [],
    "E_ORPHANED_INVALID": [],
    "F_UNKNOWN": []
}

# Test/Fake IDs and patterns
test_patterns = [
    "INC-WEBCAM-", "INC-EVID-TEST-", "INC-TEST-", "CAM-PIPE-TEST", "CAM-SUSP-TEST", "CAM-NM-TEST", "CAM-ID-SEM"
]

# Track groupings to find duplicate incidents for the same episode
# An episode is continuous detections for (camera_id, track_id) within a close time window or same run
episodes = defaultdict(list)

for inc in incidents:
    inc_ev = ev_by_inc.get(inc.incident_id, []) + ev_by_inc.get(inc.id, [])
    seen_ev = set()
    ev_files = []
    for e in inc_ev:
        if e.id not in seen_ev:
            seen_ev.add(e.id)
            ev_files.append(os.path.basename(e.file_path))
    if inc.snapshot_url and os.path.basename(inc.snapshot_url) not in ev_files:
        ev_files.append(os.path.basename(inc.snapshot_url))

    has_phys = any(file_exists(fn) for fn in ev_files)
    is_linked = (inc.incident_id in susp_by_inc) or (inc.incident_id in night_by_inc) or (inc.incident_id in sec_by_inc)

    info = {
        "incident_id": inc.incident_id,
        "id": inc.id,
        "camera_id": inc.camera_id,
        "track_id": inc.track_id,
        "event_type": inc.event_type,
        "timestamp": inc.timestamp.isoformat() if inc.timestamp else None,
        "ts_obj": inc.timestamp,
        "threat_score": inc.threat_score,
        "threat_level": inc.threat_level,
        "snapshot_url": inc.snapshot_url,
        "ev_files": ev_files,
        "has_physical_evidence": has_phys,
        "is_linked_to_core_event": is_linked,
        "reason": inc.explainable_reason
    }

    # Check if explicitly test/fake
    is_test = False
    for pat in test_patterns:
        if pat in inc.incident_id or (inc.camera_id and pat in inc.camera_id):
            is_test = True
            break
    if inc.explainable_reason and ("test" in inc.explainable_reason.lower() or "synthetic" in inc.explainable_reason.lower()):
        is_test = True

    if is_test:
        classification["D_TEST_SYNTHETIC_FAKE"].append(info)
        continue

    episodes[(inc.camera_id, inc.track_id)].append(info)

# Now evaluate duplicate vs genuine in episodes
for (cam, trk), inc_list in episodes.items():
    if len(inc_list) == 1:
        item = inc_list[0]
        if item["has_physical_evidence"]:
            classification["A_GENUINE_VALID_EVIDENCE"].append(item)
        elif item["snapshot_url"]:
            classification["B_GENUINE_MISSING_EVIDENCE"].append(item)
        else:
            # No snapshot url at all - is it linked?
            if item["is_linked_to_core_event"]:
                classification["B_GENUINE_MISSING_EVIDENCE"].append(item)
            else:
                classification["F_UNKNOWN"].append(item)
    else:
        # Multiple incidents for this (camera, track).
        # Check time gaps between consecutive incidents
        current_cluster = [inc_list[0]]
        for nxt in inc_list[1:]:
            prev = current_cluster[-1]
            if prev["ts_obj"] and nxt["ts_obj"]:
                gap_sec = (nxt["ts_obj"] - prev["ts_obj"]).total_seconds()
            else:
                gap_sec = 999999

            # If same day/hour and within 10 minutes (continuous tracking episode) or same event_type burst
            if gap_sec < 600:
                current_cluster.append(nxt)
            else:
                # Process finished cluster
                # Primary should be the one with physical evidence, or highest threat, or earliest
                primary = None
                for c in current_cluster:
                    if c["has_physical_evidence"]:
                        primary = c
                        break
                if not primary:
                    primary = current_cluster[0]

                for c in current_cluster:
                    if c["incident_id"] == primary["incident_id"]:
                        if c["has_physical_evidence"]:
                            classification["A_GENUINE_VALID_EVIDENCE"].append(c)
                        else:
                            classification["B_GENUINE_MISSING_EVIDENCE"].append(c)
                    else:
                        c["duplicate_of"] = primary["incident_id"]
                        classification["C_DUPLICATE"].append(c)

                current_cluster = [nxt]

        # Process last cluster
        primary = None
        for c in current_cluster:
            if c["has_physical_evidence"]:
                primary = c
                break
        if not primary:
            primary = current_cluster[0]

        for c in current_cluster:
            if c["incident_id"] == primary["incident_id"]:
                if c["has_physical_evidence"]:
                    classification["A_GENUINE_VALID_EVIDENCE"].append(c)
                else:
                    classification["B_GENUINE_MISSING_EVIDENCE"].append(c)
            else:
                c["duplicate_of"] = primary["incident_id"]
                classification["C_DUPLICATE"].append(c)

print("\n=== CLASSIFICATION SUMMARY ===")
for cat, items in classification.items():
    print(f"  {cat}: {len(items)}")

with open("scratch/classification_result.json", "w") as f:
    json.dump({k: [i for i in v] for k, v in classification.items()}, f, default=str, indent=2)
print("\nSaved detailed classification to scratch/classification_result.json")
