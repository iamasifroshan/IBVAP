import sys
import os
import json

sys.path.insert(0, 'backend')
from database.db import SessionLocal
from database.models import (
    IncidentModel, EvidenceModel, SecurityEventModel,
    SuspiciousActivityModel, NightMovementModel, TrackModel
)

db = SessionLocal()

print("--- SECURITY EVENTS ---")
for se in db.query(SecurityEventModel).all():
    print(f"ID: {se.id} | EventID: {se.event_id} | Cam: {se.camera_id} | Track: {se.track_id} | Subject: {se.subject_type} | Threat: {se.threat_level}/{se.threat_score} | Incidents: {se.related_incident_ids}")

print("\n--- SUSPICIOUS ACTIVITIES ---")
for sa in db.query(SuspiciousActivityModel).all():
    print(f"ID: {sa.id} | ActivityID: {sa.activity_id} | Cam: {sa.camera_id} | Track: {sa.track_id} | Type: {sa.activity_type} | Severity: {sa.severity} | IncidentID: {sa.incident_id}")

print("\n--- NIGHT MOVEMENTS ---")
for nm in db.query(NightMovementModel).all():
    print(f"ID: {nm.id} | MovementID: {nm.movement_id} | Cam: {nm.camera_id} | Track: {nm.track_id} | Displacement: {nm.displacement} | IncidentID: {nm.incident_id}")
