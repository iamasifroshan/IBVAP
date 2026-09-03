import sqlite3, json

conn = sqlite3.connect('ibvap_backup.db')
c = conn.cursor()

# Check TRK#2 evidence image
c.execute("SELECT id, incident_id, file_path FROM evidence WHERE incident_id='14ae4497-603f-4749-bc99-3bbe1f2ae1b0'")
evs = c.fetchall()
print("TRK#2 evidence:", evs)

# Get ALL detections for TRK#2 to see bbox history
c.execute("SELECT bounding_box FROM detections WHERE track_id='2' ORDER BY id")
dets = c.fetchall()
print(f"TRK#2 total detections: {len(dets)}")
for d in dets:
    if d[0]:
        try:
            bbox = json.loads(d[0])
            w = bbox.get("width", 0.0)
            h = bbox.get("height", 0.0)
            x = bbox.get("x", 0.0)
            y = bbox.get("y", 0.0)
            aspect = w/h if h > 0 else 0
            print(f"  x={x:.3f} y={y:.3f} w={w:.3f} h={h:.3f} aspect={aspect:.3f}")
        except Exception as e:
            print(f"  parse error: {e}")
conn.close()
