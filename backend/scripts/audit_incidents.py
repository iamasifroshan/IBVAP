"""
IBVAP Incident Audit Script
============================
Phase 2: Audit all historical incidents and classify each one.
Inspects actual evidence image content — does NOT classify based on status/type alone.

Classification:
  GENUINE        - Confirmed real person in evidence, or legitimate multi-person video run
  FAKE_CLOUD     - Evidence image contains no person (background/cloud/noise only)
  NO_EVIDENCE    - Incident has no associated evidence (needs manual review)
  ORPHAN_EVIDENCE - Evidence record references a deleted/missing incident
  REVIEW_REQUIRED - Borderline / needs human eyes

Usage:
  python backend/scripts/audit_incidents.py
"""

import sys
import os
import sqlite3
import csv
import json
import hashlib
from datetime import datetime

# We use cv2 and numpy for image analysis
try:
    import cv2
    import numpy as np
    VISION_AVAILABLE = True
except ImportError:
    VISION_AVAILABLE = False
    print("WARNING: cv2/numpy not available — image analysis will be skipped")

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ibvap.db")
EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "evidence")
OUTPUT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "incident_audit_report.csv")

# ── Perceptual Hash (8x8 average hash) ────────────────────────────────────────
def compute_phash(img_path: str):
    """Compute 64-bit perceptual hash (average hash) for image."""
    if not VISION_AVAILABLE:
        return None, None, None
    img = cv2.imread(img_path)
    if img is None:
        return None, None, None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (8, 8))
    mean_val = small.mean()
    bits = ''.join('1' if px >= mean_val else '0' for row in small for px in row)
    phash = int(bits, 2)

    # Image stats
    avg_b = float(np.mean(img[:, :, 0]))
    avg_g = float(np.mean(img[:, :, 1]))
    avg_r = float(np.mean(img[:, :, 2]))
    std = float(np.std(img))

    return phash, (avg_r, avg_g, avg_b), std


def hamming_distance(h1: int, h2: int) -> int:
    """Bit-level Hamming distance between two 64-bit hashes."""
    return bin(h1 ^ h2).count('1')


def analyze_image(img_path: str):
    """
    Analyze image content to determine if it contains a real person.
    
    Returns dict with:
      has_person_region: bool (crude bounding-box overlap heuristic)
      texture_std: float (low = uniform background like sky/cloud)
      face_candidate_regions: int
      avg_rgb: tuple
      phash: int
      classification_hint: str
    """
    if not VISION_AVAILABLE or not img_path or not os.path.exists(img_path):
        return {"classification_hint": "NO_FILE", "error": "File missing or cv2 unavailable"}

    img = cv2.imread(img_path)
    if img is None:
        return {"classification_hint": "READ_ERROR", "error": "cv2.imread returned None"}

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1. Global texture variance (very low = uniform cloud/sky/wall)
    std_global = float(np.std(gray))

    # 2. Look for red bounding box overlay drawn by evidence_generator
    #    Red box: high R, low G, low B → (R > 150, G < 80, B < 80)
    red_mask = (img[:, :, 2] > 150) & (img[:, :, 1] < 80) & (img[:, :, 0] < 80)
    red_pixel_count = int(np.sum(red_mask))
    has_red_bbox = red_pixel_count > 200  # At least 200 red pixels → drawn bbox

    # 3. Green bounding box (known person overlay)
    green_mask = (img[:, :, 1] > 150) & (img[:, :, 2] < 80) & (img[:, :, 0] < 80)
    green_pixel_count = int(np.sum(green_mask))
    has_green_bbox = green_pixel_count > 200

    # 4. Skin-tone detection (crude estimate of human presence)
    # HSV skin range (non-normalized)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_skin = np.array([0, 20, 70], dtype=np.uint8)
    upper_skin = np.array([20, 150, 255], dtype=np.uint8)
    skin_mask = cv2.inRange(hsv, lower_skin, upper_skin)
    skin_pixels = int(np.sum(skin_mask > 0))
    skin_ratio = skin_pixels / (h * w) if (h * w) > 0 else 0.0
    has_skin = skin_ratio > 0.01  # >1% skin pixels

    # 5. Dark region (person body — dark clothing common)
    dark_mask = gray < 60
    dark_ratio = float(np.sum(dark_mask)) / (h * w)
    has_dark_body = dark_ratio > 0.05  # >5% very dark pixels

    # 6. Edge density (persons have many edges; featureless bg has few)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.sum(edges > 0)) / (h * w)
    has_edges = edge_density > 0.03

    # 7. Compute perceptual hash
    small = cv2.resize(gray, (8, 8))
    mean_val = small.mean()
    bits = ''.join('1' if px >= mean_val else '0' for row in small for px in row)
    phash = int(bits, 2)

    avg_r = float(np.mean(img[:, :, 2]))
    avg_g = float(np.mean(img[:, :, 1]))
    avg_b = float(np.mean(img[:, :, 0]))

    # ── Classification heuristic ──────────────────────────────────────────────
    # GENUINE: has drawn bbox (red/green) OR has skin pixels OR has dark body + edges
    # FAKE_CLOUD: very uniform (low std), no bbox, no skin, no dark body
    person_signals = sum([
        has_red_bbox,
        has_green_bbox,
        has_skin,
        has_dark_body and has_edges,
    ])

    if std_global < 15 and not has_red_bbox and not has_green_bbox and skin_ratio < 0.005:
        hint = "FAKE_CLOUD"  # extremely uniform, no overlay, no skin
    elif person_signals >= 2:
        hint = "GENUINE"
    elif has_red_bbox or has_green_bbox:
        hint = "GENUINE"  # has drawn bbox → was definitely a confirmed detection
    elif person_signals == 1:
        hint = "REVIEW_REQUIRED"
    else:
        hint = "REVIEW_REQUIRED"

    return {
        "classification_hint": hint,
        "std_global": round(std_global, 2),
        "has_red_bbox": has_red_bbox,
        "has_green_bbox": has_green_bbox,
        "red_pixels": red_pixel_count,
        "green_pixels": green_pixel_count,
        "has_skin": has_skin,
        "skin_ratio": round(skin_ratio, 4),
        "has_dark_body": has_dark_body,
        "dark_ratio": round(dark_ratio, 4),
        "has_edges": has_edges,
        "edge_density": round(edge_density, 4),
        "avg_rgb": (round(avg_r, 1), round(avg_g, 1), round(avg_b, 1)),
        "phash": f"{phash:016x}",
        "phash_int": phash,
        "person_signals": person_signals,
    }


def main():
    print("=" * 80)
    print("IBVAP INCIDENT AUDIT REPORT")
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Database: {DB_PATH}")
    print("=" * 80)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # ── Step 1: Gather all incidents ─────────────────────────────────────────
    c.execute("""
        SELECT i.id, i.incident_id, i.camera_id, i.camera_name, i.timestamp,
               i.track_id, i.event_type, i.status, i.threat_score, i.threat_level,
               i.person_name, i.face_recognized, i.face_confidence,
               i.smart_alert_confirmed, i.validation_checks, i.explainable_reason,
               i.zone_name
        FROM incidents i
        ORDER BY i.timestamp
    """)
    incidents = [dict(r) for r in c.fetchall()]

    # ── Step 2: Gather all evidence ──────────────────────────────────────────
    c.execute("""
        SELECT e.id as ev_id, e.incident_id, e.evidence_type, e.file_path,
               e.sha256_hash, e.created_at
        FROM evidence e
    """)
    evidence_rows = [dict(r) for r in c.fetchall()]

    # Build index: incident_id → list of evidence records
    ev_by_incident = {}
    for ev in evidence_rows:
        iid = ev["incident_id"]
        ev_by_incident.setdefault(iid, []).append(ev)

    # All incident_ids that actually exist
    existing_incident_ids = {inc["incident_id"] for inc in incidents}

    # Find orphan evidence (points to non-existent incident)
    orphan_evidence = [ev for ev in evidence_rows if ev["incident_id"] not in existing_incident_ids]

    print(f"\nTotal incidents: {len(incidents)}")
    print(f"Total evidence records: {len(evidence_rows)}")
    print(f"Orphan evidence records: {len(orphan_evidence)}")

    # ── Step 3: Audit each incident ──────────────────────────────────────────
    audit_rows = []
    all_phashes = {}  # phash_int → list of incident_ids (for duplicate detection)

    print("\nAuditing incidents...\n")

    for inc in incidents:
        iid = inc["incident_id"]
        cam = inc["camera_id"]
        ts = inc["timestamp"]
        trk = inc["track_id"]

        ev_list = ev_by_incident.get(iid, []) + ev_by_incident.get(inc["id"], [])
        # Deduplicate by ev_id
        seen = set()
        deduped = []
        for ev in ev_list:
            if ev["ev_id"] not in seen:
                seen.add(ev["ev_id"])
                deduped.append(ev)
        ev_list = deduped

        # Parse validation_checks for rule decisions
        try:
            vc = json.loads(inc["validation_checks"]) if inc["validation_checks"] else {}
        except Exception:
            vc = {}

        rule7_status = ""
        if "rule7_identity_verification" in vc:
            rule7_status = vc["rule7_identity_verification"].get("status", "")

        # ── Classify ──────────────────────────────────────────────────────────
        if not ev_list:
            # No evidence at all
            image_analysis = {"classification_hint": "NO_EVIDENCE"}
            final_classification = "NO_EVIDENCE"
            ev_id = ""
            ev_path = ""
            ev_hint = ""
            phash_str = ""
            std_global = ""
            has_red_bbox = ""
            has_skin = ""
            skin_ratio = ""
        else:
            # Analyze first snapshot evidence image
            snapshot_ev = next((e for e in ev_list if e["evidence_type"] == "snapshot"), ev_list[0])
            ev_id = snapshot_ev["ev_id"]
            ev_path = snapshot_ev["file_path"] or ""

            image_analysis = analyze_image(ev_path)
            ev_hint = image_analysis.get("classification_hint", "UNKNOWN")
            phash_str = image_analysis.get("phash", "")
            std_global = image_analysis.get("std_global", "")
            has_red_bbox = image_analysis.get("has_red_bbox", "")
            has_skin = image_analysis.get("has_skin", "")
            skin_ratio = image_analysis.get("skin_ratio", "")
            phash_int = image_analysis.get("phash_int")

            if phash_int is not None:
                all_phashes.setdefault(phash_int, []).append(iid)

            final_classification = ev_hint

        row = {
            "incident_id": iid,
            "camera_id": cam,
            "timestamp": ts,
            "track_id": trk,
            "status": inc["status"],
            "threat_score": inc["threat_score"],
            "threat_level": inc["threat_level"],
            "person_name": inc["person_name"],
            "face_recognized": inc["face_recognized"],
            "face_confidence": inc["face_confidence"],
            "rule7_identity_status": rule7_status,
            "smart_alert_confirmed": inc["smart_alert_confirmed"],
            "zone_name": inc["zone_name"],
            "explainable_reason": (inc["explainable_reason"] or "")[:80],
            "evidence_count": len(ev_list),
            "evidence_id": ev_id,
            "evidence_path": ev_path,
            "phash": phash_str,
            "std_global": std_global,
            "has_red_bbox": has_red_bbox,
            "has_skin": has_skin,
            "skin_ratio": skin_ratio,
            "image_classification_hint": image_analysis.get("classification_hint", ""),
            "final_classification": final_classification,
            "notes": "",
        }
        audit_rows.append(row)

    # ── Step 4: Near-duplicate image detection ────────────────────────────────
    # If multiple incidents share a phash with Hamming distance < 8,
    # they may be the same frame repeated
    phash_list = [(iid, int(r["phash"], 16)) for r in audit_rows
                  if r["phash"] and r["phash"] != "" and r.get("evidence_id")]

    duplicate_groups = []  # list of sets of incident_ids
    matched = set()
    for i, (iid_a, ph_a) in enumerate(phash_list):
        if iid_a in matched:
            continue
        group = {iid_a}
        for j, (iid_b, ph_b) in enumerate(phash_list):
            if i == j or iid_b in matched:
                continue
            if hamming_distance(ph_a, ph_b) <= 5:
                group.add(iid_b)
        if len(group) > 1:
            duplicate_groups.append(group)
            matched.update(group)

    # Annotate duplicates
    for group in duplicate_groups:
        for row in audit_rows:
            if row["incident_id"] in group:
                others = group - {row["incident_id"]}
                row["notes"] = f"NEAR_DUPLICATE_IMAGE with: {', '.join(sorted(others))}"

    # ── Step 5: Orphan evidence audit ────────────────────────────────────────
    orphan_rows = []
    for ev in orphan_evidence:
        ev_path = ev["file_path"] or ""
        image_analysis = analyze_image(ev_path)
        orphan_rows.append({
            "evidence_id": ev["ev_id"],
            "incident_id_ref": ev["incident_id"],
            "evidence_type": ev["evidence_type"],
            "file_path": ev_path,
            "file_exists": os.path.exists(ev_path) if ev_path else False,
            "image_hint": image_analysis.get("classification_hint", "NO_FILE"),
            "phash": image_analysis.get("phash", ""),
        })

    conn.close()

    # ── Step 6: Print summary ────────────────────────────────────────────────
    from collections import Counter
    classification_counts = Counter(r["final_classification"] for r in audit_rows)

    print("\n=== CLASSIFICATION SUMMARY ===")
    for cls, cnt in sorted(classification_counts.items()):
        print(f"  {cls}: {cnt}")

    print("\n=== FAKE_CLOUD candidates (if any) ===")
    fake_candidates = [r for r in audit_rows if r["final_classification"] == "FAKE_CLOUD"]
    if fake_candidates:
        for r in fake_candidates:
            print(f"  {r['incident_id']} | cam={r['camera_id']} | ts={r['timestamp']} | trk={r['track_id']} | std={r['std_global']}")
    else:
        print("  (none found — no evidence images contain pure cloud/background content)")

    print("\n=== REVIEW_REQUIRED ===")
    review = [r for r in audit_rows if r["final_classification"] == "REVIEW_REQUIRED"]
    for r in review:
        print(f"  {r['incident_id']} | cam={r['camera_id']} | ts={r['timestamp']} | std={r['std_global']} | has_red_bbox={r['has_red_bbox']} | has_skin={r['has_skin']}")

    print("\n=== NO_EVIDENCE incidents ===")
    no_ev = [r for r in audit_rows if r["final_classification"] == "NO_EVIDENCE"]
    print(f"  Total: {len(no_ev)}")
    for r in no_ev[:10]:
        print(f"  {r['incident_id']} | cam={r['camera_id']} | ts={r['timestamp']} | trk={r['track_id']} | rule7={r['rule7_identity_status']}")
    if len(no_ev) > 10:
        print(f"  ... and {len(no_ev)-10} more")

    print("\n=== NEAR-DUPLICATE IMAGE GROUPS ===")
    if duplicate_groups:
        for g in duplicate_groups:
            print(f"  Group: {sorted(g)}")
    else:
        print("  (none)")

    print("\n=== ORPHAN EVIDENCE (references deleted incidents) ===")
    for ev in orphan_rows:
        print(f"  ev_id={ev['evidence_id']} | incident_id_ref={ev['incident_id_ref']} | exists={ev['file_exists']} | hint={ev['image_hint']}")

    # ── Step 7: Write CSV ─────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        if audit_rows:
            writer = csv.DictWriter(f, fieldnames=audit_rows[0].keys())
            writer.writeheader()
            writer.writerows(audit_rows)

    print(f"\n[OK] Audit CSV written: {OUTPUT_CSV}")
    print(f"\n=== FINAL STATS ===")
    print(f"INCIDENTS AUDITED: {len(incidents)}")
    print(f"EVIDENCE AUDITED: {len(evidence_rows)}")
    print(f"ORPHAN EVIDENCE: {len(orphan_evidence)}")
    print(f"GENUINE: {classification_counts.get('GENUINE', 0)}")
    print(f"FAKE_CLOUD: {classification_counts.get('FAKE_CLOUD', 0)}")
    print(f"NO_EVIDENCE: {classification_counts.get('NO_EVIDENCE', 0)}")
    print(f"REVIEW_REQUIRED: {classification_counts.get('REVIEW_REQUIRED', 0)}")

    return audit_rows, orphan_rows


if __name__ == "__main__":
    main()
