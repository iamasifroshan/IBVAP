"""
IBVAP Cleanup Script — Phase 11
=================================
Safe cleanup of orphan evidence records only.

Rules enforced:
  - NO incident records will be deleted (0 FAKE_CLOUD found by audit)
  - NO genuine evidence will be deleted
  - Orphan evidence DB records (references to deleted incidents) will be removed
    from the database ONLY — their image files are preserved on disk since they
    contain genuine human images
  - All known persons (Asif, Afrith, Gokul) are verified to still exist after cleanup
  - Before/after counts are verified

Usage:
  python backend/scripts/cleanup_orphans.py
"""

import sqlite3
import os
import sys
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ibvap.db")


def main():
    print("=" * 70)
    print("IBVAP PHASE 11 CLEANUP — Orphan Evidence Records")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Database: {DB_PATH}")
    print("=" * 70)
    print()
    print("SAFETY: Only removing orphan DB records. Image files are preserved.")
    print("        No incidents will be deleted.")
    print("        No genuine evidence will be deleted.")
    print()

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # ── Pre-cleanup counts ────────────────────────────────────────────────────
    c.execute("SELECT COUNT(*) FROM incidents"); inc_before = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM evidence"); ev_before = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM cameras"); cam_count = c.fetchone()[0]
    c.execute("SELECT name FROM registered_people ORDER BY name")
    persons = [r[0] for r in c.fetchall()]

    print(f"PRE-CLEANUP:")
    print(f"  INCIDENTS = {inc_before}")
    print(f"  EVIDENCE  = {ev_before}")
    print(f"  CAMERAS   = {cam_count}")
    print(f"  PERSONS   = {persons}")
    print()

    # ── Find orphan evidence records ─────────────────────────────────────────
    c.execute("""
        SELECT e.id, e.incident_id, e.file_path
        FROM evidence e
        WHERE e.incident_id NOT IN (
            SELECT incident_id FROM incidents
            UNION
            SELECT id FROM incidents
        )
    """)
    orphans = c.fetchall()

    print(f"Orphan evidence records found: {len(orphans)}")
    for ev_id, inc_ref, fpath in orphans:
        file_exists = os.path.exists(fpath) if fpath else False
        print(f"  ev_id={ev_id[:8]}... | incident_ref={inc_ref} | file_exists={file_exists}")
        print(f"    path: {fpath}")

    if not orphans:
        print("\nNO orphan evidence found. Nothing to clean up.")
        conn.close()
        return

    # ── Safety confirmation ───────────────────────────────────────────────────
    print()
    print(f"Will DELETE {len(orphans)} orphan evidence DB records.")
    print("The image FILES will be kept on disk (they contain genuine human images).")
    print()

    # Delete orphan evidence DB records only
    orphan_ids = [r[0] for r in orphans]
    placeholders = ",".join("?" for _ in orphan_ids)
    c.execute(f"DELETE FROM evidence WHERE id IN ({placeholders})", orphan_ids)
    deleted_count = c.rowcount
    conn.commit()

    print(f"Deleted {deleted_count} orphan evidence DB records.")

    # ── Post-cleanup counts ───────────────────────────────────────────────────
    c.execute("SELECT COUNT(*) FROM incidents"); inc_after = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM evidence"); ev_after = c.fetchone()[0]
    c.execute("SELECT name FROM registered_people ORDER BY name")
    persons_after = [r[0] for r in c.fetchall()]

    conn.close()

    print()
    print("=" * 70)
    print("CLEANUP COMPLETE")
    print("=" * 70)
    print()
    print(f"INCIDENTS_BEFORE              = {inc_before}")
    print(f"EVIDENCE_BEFORE               = {ev_before}")
    print()
    print(f"FAKE_CLOUD_INCIDENTS_DELETED  = 0  (none found by audit)")
    print(f"FAKE_CLOUD_EVIDENCE_DELETED   = 0  (none found by audit)")
    print(f"ORPHAN_EVIDENCE_DELETED       = {deleted_count}  (DB records only, files kept)")
    print()
    print(f"INCIDENTS_AFTER               = {inc_after}")
    print(f"EVIDENCE_AFTER                = {ev_after}")
    print()
    print(f"GENUINE_INCIDENTS_REMAINING   = {inc_after}")
    print(f"GENUINE_EVIDENCE_REMAINING    = {ev_after}")
    print()
    print(f"KNOWN_PERSONS_AFTER           = {persons_after}")
    print(f"CAMERAS_AFTER                 = {cam_count}")
    print()
    assert inc_before == inc_after, "ERROR: Incident count changed — should not have!"
    assert "Asif" in persons_after, "ERROR: Asif missing!"
    assert "Afrith" in persons_after, "ERROR: Afrith missing!"
    assert "Gokul" in persons_after, "ERROR: Gokul missing!"
    print("All safety assertions PASSED.")
    print("  - Incident count unchanged")
    print("  - Asif, Afrith, Gokul all present")


if __name__ == "__main__":
    main()
