"""
Relationship-Safe Incident Cleanup Script for IBVAP
===================================================
1. Preserves all 31 genuine incidents backed by physical evidence.
2. Preserves historical incidents with missing evidence in the database.
3. Identifies and merges redundant duplicate bursts (same camera, same track, same episode)
   that have NO unique physical evidence.
4. Repoints any evidence or foreign links before deleting redundant duplicate rows.
5. Preserves all other tables (cameras, registered people, faces, tracks, detections, zones, videos).
"""

import os
import sys
import argparse
from datetime import datetime, timezone

sys.path.insert(0, 'backend')
from database.db import SessionLocal
from database.models import (
    IncidentModel, EvidenceModel, SecurityEventModel,
    SuspiciousActivityModel, NightMovementModel, TrackModel,
    CameraModel, RegisteredPersonModel, FaceReferenceModel,
    DetectionModel, ZoneModel, VideoModel
)

def get_table_counts(db):
    return {
        "cameras": db.query(CameraModel).count(),
        "incidents": db.query(IncidentModel).count(),
        "evidence": db.query(EvidenceModel).count(),
        "registered_people": db.query(RegisteredPersonModel).count(),
        "face_references": db.query(FaceReferenceModel).count(),
        "detections": db.query(DetectionModel).count(),
        "tracks": db.query(TrackModel).count(),
        "zones": db.query(ZoneModel).count(),
        "videos": db.query(VideoModel).count(),
        "suspicious_activities": db.query(SuspiciousActivityModel).count(),
        "night_movements": db.query(NightMovementModel).count(),
        "security_events": db.query(SecurityEventModel).count(),
    }

def main():
    parser = argparse.ArgumentParser(description="Clean duplicate and invalid incidents")
    parser.add_argument("--dry-run", action="store_true", help="Simulate cleanup without writing to DB")
    args = parser.parse_args()

    db = SessionLocal()
    before_counts = get_table_counts(db)
    print("=" * 60)
    print(f"DATABASE CLEANUP (Mode: {'DRY RUN' if args.dry_run else 'LIVE EXECUTION'})")
    print("=" * 60)
    print("Before counts:")
    for k, v in before_counts.items():
        print(f"  {k}: {v}")

    ev_dir = os.path.join('backend', 'storage', 'evidence')
    pub_ev_dir = os.path.join('public', 'storage', 'evidence')

    def file_exists(fname):
        if not fname:
            return False
        b = os.path.basename(fname)
        return os.path.exists(os.path.join(ev_dir, b)) or os.path.exists(os.path.join(pub_ev_dir, b))

    # All incidents
    all_incidents = db.query(IncidentModel).order_by(IncidentModel.timestamp.asc()).all()

    # Determine incidents that have physical evidence
    evidence_backed_ids = set()
    for inc in all_incidents:
        snap = inc.snapshot_url
        ev_rows = db.query(EvidenceModel).filter(
            (EvidenceModel.incident_id == inc.incident_id) | (EvidenceModel.incident_id == inc.id)
        ).all()
        files = [os.path.basename(e.file_path) for e in ev_rows]
        if snap:
            files.append(os.path.basename(snap))
        if any(file_exists(f) for f in files):
            evidence_backed_ids.add(inc.incident_id)
            evidence_backed_ids.add(inc.id)

    print(f"\nAuthoritative Evidence-Backed Incidents Found: {len(evidence_backed_ids)//2 if len(evidence_backed_ids) > 0 else 0}")

    # Identify true duplicate bursts:
    # Same camera, same track_id, continuous episode within 10 minutes,
    # where the duplicate has NO unique physical evidence file.
    clusters = {}
    for inc in all_incidents:
        key = (inc.camera_id, inc.track_id)
        if key not in clusters:
            clusters[key] = []
        clusters[key].append(inc)

    duplicates_to_delete = []
    repointed_links = []

    for (cam, trk), inc_list in clusters.items():
        if len(inc_list) <= 1:
            continue

        # Group into time clusters (within 15 minutes of previous incident)
        current_cluster = [inc_list[0]]
        for nxt in inc_list[1:]:
            prev = current_cluster[-1]
            gap_sec = (nxt.timestamp - prev.timestamp).total_seconds() if (nxt.timestamp and prev.timestamp) else 999999
            if gap_sec <= 900:  # 15 minutes
                current_cluster.append(nxt)
            else:
                # Evaluate cluster
                if len(current_cluster) > 1:
                    # Pick primary: preferably evidence-backed, otherwise first
                    primary = next((c for c in current_cluster if c.incident_id in evidence_backed_ids), current_cluster[0])
                    for c in current_cluster:
                        if c.id != primary.id and c.incident_id != primary.incident_id:
                            # Only treat as duplicate if it doesn't have its OWN physical evidence file
                            if c.incident_id not in evidence_backed_ids:
                                duplicates_to_delete.append((c, primary, f"Duplicate burst of primary {primary.incident_id} within 15min ({gap_sec:.0f}s)"))
                current_cluster = [nxt]

        if len(current_cluster) > 1:
            primary = next((c for c in current_cluster if c.incident_id in evidence_backed_ids), current_cluster[0])
            for c in current_cluster:
                if c.id != primary.id and c.incident_id != primary.incident_id:
                    if c.incident_id not in evidence_backed_ids:
                        duplicates_to_delete.append((c, primary, f"Duplicate burst of primary {primary.incident_id} in cluster"))

    print(f"\nIdentified {len(duplicates_to_delete)} true duplicate incidents for cleanup.")
    print("-" * 60)
    for dup_inc, primary_inc, reason in duplicates_to_delete:
        print(f"DELETE CANDIDATE: {dup_inc.incident_id:20} (Track: {dup_inc.track_id}, Time: {dup_inc.timestamp})")
        print(f"   Reason: {reason}")
        print(f"   Primary Retained: {primary_inc.incident_id}")

        # Check for any evidence rows attached to duplicate
        dup_evs = db.query(EvidenceModel).filter(
            (EvidenceModel.incident_id == dup_inc.incident_id) | (EvidenceModel.incident_id == dup_inc.id)
        ).all()
        for ev in dup_evs:
            repointed_links.append((f"Evidence {ev.id}", f"{dup_inc.incident_id} -> {primary_inc.incident_id}"))
            if not args.dry_run:
                ev.incident_id = primary_inc.incident_id

        # Check for any SuspiciousActivityModel linked
        sa_rows = db.query(SuspiciousActivityModel).filter(
            (SuspiciousActivityModel.incident_id == dup_inc.incident_id) | (SuspiciousActivityModel.incident_id == dup_inc.id)
        ).all()
        for sa in sa_rows:
            repointed_links.append((f"SuspiciousActivity {sa.id}", f"{dup_inc.incident_id} -> {primary_inc.incident_id}"))
            if not args.dry_run:
                sa.incident_id = primary_inc.incident_id

        # Check for any NightMovementModel linked
        nm_rows = db.query(NightMovementModel).filter(
            (NightMovementModel.incident_id == dup_inc.incident_id) | (NightMovementModel.incident_id == dup_inc.id)
        ).all()
        for nm in nm_rows:
            repointed_links.append((f"NightMovement {nm.id}", f"{dup_inc.incident_id} -> {primary_inc.incident_id}"))
            if not args.dry_run:
                nm.incident_id = primary_inc.incident_id

        # Check for any SecurityEventModel linked
        for se in db.query(SecurityEventModel).all():
            if dup_inc.incident_id in (se.related_incident_ids or []):
                repointed_links.append((f"SecurityEvent {se.event_id}", f"{dup_inc.incident_id} -> {primary_inc.incident_id}"))
                if not args.dry_run:
                    updated_list = [primary_inc.incident_id if x == dup_inc.incident_id else x for x in se.related_incident_ids]
                    se.related_incident_ids = list(dict.fromkeys(updated_list))

        if not args.dry_run:
            db.delete(dup_inc)

    if not args.dry_run:
        db.commit()
        print("\nDatabase changes committed.")
    else:
        print("\n[DRY RUN COMPLETE] No changes written to database.")

    after_counts = get_table_counts(db)
    print("\n" + "=" * 60)
    print("Table Counts Summary:")
    print("=" * 60)
    for k in before_counts:
        diff = after_counts[k] - before_counts[k]
        diff_str = f" ({diff:+d})" if diff != 0 else " (unchanged)"
        print(f"  {k:22}: Before={before_counts[k]:6} | After={after_counts[k]:6}{diff_str}")

    db.close()

if __name__ == "__main__":
    main()
