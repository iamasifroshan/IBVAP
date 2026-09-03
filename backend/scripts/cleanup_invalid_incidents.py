import sqlite3
import json
import os
import shutil
import argparse
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'ibvap.db')
STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'storage', 'evidence')

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def backup_database():
    backup_path = DB_PATH + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(DB_PATH, backup_path)
    return backup_path

def is_bbox_invalid(bbox):
    if not bbox:
        return True
    w = bbox.get("width", 0.0)
    h = bbox.get("height", 0.0)
    area = w * h
    aspect = w / h if h > 0 else 0
    if area < 0.0025 or aspect < 0.35 or aspect > 2.80:
        return True
    return False

def main():
    parser = argparse.ArgumentParser(description="Cleanup Invalid Incidents")
    parser.add_argument("--execute", action="store_true", help="Actually delete the records")
    args = parser.parse_args()
    
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return
        
    print("==================================================")
    print("IBVAP INVALID INCIDENT CLEANUP TOOL")
    print("==================================================")
    
    if args.execute:
        backup_path = backup_database()
        print(f"[BACKUP] Created database backup at: {backup_path}")
    else:
        print("[DRY RUN] No changes will be made to the database. Use --execute to apply.")

    conn = get_db_connection()
    c = conn.cursor()
    
    # Pre-cleanup stats
    c.execute("SELECT COUNT(*) FROM incidents")
    total_incidents_before = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM evidence")
    total_evidence_before = c.fetchone()[0]
    
    print(f"\n--- BEFORE CLEANUP ---")
    print(f"Total Incidents: {total_incidents_before}")
    print(f"Total Evidence Records: {total_evidence_before}")
    
    # Identify invalid incidents
    c.execute("SELECT id, incident_id, event_type, explainable_reason, track_id FROM incidents")
    all_incidents = c.fetchall()
    
    invalid_incidents = set()
    valid_incidents = set()
    
    for row in all_incidents:
        db_id, inc_id, event_type, reason, track_id_str = row
        is_invalid = False
        
        # 1. Old Multiple Person Logic
        if event_type == "MULTIPLE_PERSONS_DETECTED" or (reason and "Multiple individuals" in reason) or (reason and "persons detected on webcam" in reason):
            is_invalid = True
        
        # 2. Fake INC-WEBCAM records
        elif inc_id.startswith("INC-WEBCAM-") or "Live Alert." in (reason or ""):
            is_invalid = True
            
        # 3. Test/debug records
        elif "TEST" in inc_id or inc_id.startswith("test_") or "TRK#None" in (track_id_str or ""):
            is_invalid = True
            
        # 4. Unknown Person False Positives (Cloud/Background)
        elif event_type == "UNKNOWN_PERSON_DETECTED":
            if not track_id_str or not track_id_str.startswith("TRK#"):
                is_invalid = True # Invalid track
            else:
                track_int = track_id_str.replace("TRK#", "")
                c.execute("SELECT bounding_box FROM detections WHERE track_id=? ORDER BY id DESC LIMIT 1", (track_int,))
                det_row = c.fetchone()
                if not det_row or not det_row[0]:
                    is_invalid = True # No detection found
                else:
                    try:
                        bbox = json.loads(det_row[0])
                        if is_bbox_invalid(bbox):
                            is_invalid = True
                    except:
                        is_invalid = True
        
        if is_invalid:
            invalid_incidents.add(inc_id)
        else:
            valid_incidents.add(inc_id)
            
    # Identify orphan evidence
    c.execute("SELECT id, incident_id, file_path FROM evidence")
    all_evidence = c.fetchall()
    
    invalid_evidence = set()
    orphan_files = set()
    
    for row in all_evidence:
        ev_id, ev_inc_id, file_path = row
        
        if not ev_inc_id:
            invalid_evidence.add(ev_id)
            if file_path: orphan_files.add(file_path)
            continue
            
        # Is the parent incident invalid?
        if ev_inc_id in invalid_incidents:
            invalid_evidence.add(ev_id)
            if file_path: orphan_files.add(file_path)
            continue
            
        # Does the parent incident exist at all?
        c.execute("SELECT 1 FROM incidents WHERE incident_id=?", (ev_inc_id,))
        if not c.fetchone():
            invalid_evidence.add(ev_id)
            if file_path: orphan_files.add(file_path)
            
    # Also find files in storage that have no evidence record
    if os.path.exists(STORAGE_DIR):
        for filename in os.listdir(STORAGE_DIR):
            f_path = os.path.join(STORAGE_DIR, filename)
            # Skip non-files
            if not os.path.isfile(f_path): continue
            
            c.execute("SELECT 1 FROM evidence WHERE file_path=?", (f_path,))
            if not c.fetchone():
                orphan_files.add(f_path)
                
    print(f"\n--- IDENTIFIED INVALID DATA ---")
    print(f"Invalid Incidents: {len(invalid_incidents)}")
    print(f"Invalid Evidence Records: {len(invalid_evidence)}")
    print(f"Orphan/Unused Image Files: {len(orphan_files)}")
    
    if args.execute:
        # Delete evidence records
        for ev_id in invalid_evidence:
            c.execute("DELETE FROM evidence WHERE id=?", (ev_id,))
            
        # Delete incidents
        for inc_id in invalid_incidents:
            c.execute("DELETE FROM incidents WHERE incident_id=?", (inc_id,))
            
        # Delete files
        files_deleted = 0
        for f_path in orphan_files:
            if os.path.exists(f_path):
                try:
                    os.remove(f_path)
                    files_deleted += 1
                except:
                    pass
                    
        conn.commit()
        print(f"\n[EXECUTED] Cleaned up database and deleted {files_deleted} files.")
    
    # Post-cleanup stats
    c.execute("SELECT COUNT(*) FROM incidents")
    total_incidents_after = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM evidence")
    total_evidence_after = c.fetchone()[0]
    
    print(f"\n--- AFTER CLEANUP ---")
    print(f"Remaining Incidents: {total_incidents_after}")
    print(f"Remaining Evidence Records: {total_evidence_after}")
    print(f"Deleted Invalid Incidents: {len(invalid_incidents) if args.execute else 0}")
    print(f"Deleted Invalid Evidence: {len(invalid_evidence) if args.execute else 0}")
    print(f"Valid Incidents Preserved: {len(valid_incidents)}")
    print("==================================================")
    
    conn.close()

if __name__ == "__main__":
    main()
