import sqlite3

def run_cleanup():
    conn = sqlite3.connect('backend/ibvap.db')
    c = conn.cursor()

    # Get count of incidents before
    c.execute("SELECT COUNT(*) FROM incidents")
    count_before = c.fetchone()[0]

    # Delete fake incidents (empty snapshot_url)
    c.execute("DELETE FROM incidents WHERE snapshot_url = '' OR snapshot_url IS NULL")
    deleted_count = c.rowcount
    
    # Just to be safe, delete any orphaned evidence
    c.execute("DELETE FROM evidence WHERE incident_id NOT IN (SELECT incident_id FROM incidents)")
    deleted_evidence = c.rowcount

    # Get count of incidents after
    c.execute("SELECT COUNT(*) FROM incidents")
    count_after = c.fetchone()[0]

    conn.commit()
    conn.close()

    print(f"Cleanup complete.")
    print(f"Incidents before: {count_before}")
    print(f"Deleted fake cloud incidents (empty snapshot): {deleted_count}")
    print(f"Deleted orphaned evidence records: {deleted_evidence}")
    print(f"Incidents after: {count_after}")

if __name__ == '__main__':
    run_cleanup()
