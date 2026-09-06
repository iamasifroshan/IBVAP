import os
import sqlite3

conn = sqlite3.connect("backend/ibvap.db")
cur = conn.cursor()

base_dir = os.path.abspath("backend/storage/videos")
v1 = os.path.join(base_dir, "gettyimages-2215078536-640_adpp.mp4").replace("\\", "/")
v2 = os.path.join(base_dir, "gettyimages-2213890215-640_adpp.mp4").replace("\\", "/")
v3 = os.path.join(base_dir, "12522257-hd_1920_1080_24fps.mp4").replace("\\", "/")
v4 = os.path.join(base_dir, "17502678-hd_1080_1920_30fps.mp4").replace("\\", "/")

cur.execute("""
    UPDATE cameras 
    SET source_type = 'SIMULATED_FILE', source_url = ?, status = 'online'
    WHERE camera_id = 'BORDER-CAM-07'
""", (v1,))

cur.execute("""
    UPDATE cameras 
    SET source_type = 'SIMULATED_FILE', source_url = ?, status = 'online'
    WHERE camera_id = 'SECTOR-B-CAM-03'
""", (v2,))

cur.execute("""
    UPDATE cameras 
    SET source_type = 'SIMULATED_FILE', source_url = ?, status = 'online'
    WHERE camera_id = 'BOP-NORTH-02'
""", (v3,))

cur.execute("""
    UPDATE cameras 
    SET source_type = 'SIMULATED_FILE', source_url = ?, status = 'online'
    WHERE camera_id = 'SOUTH-TRENCH-10'
""", (v4,))

conn.commit()

cameras = cur.execute("SELECT camera_id, name, source_type, source_url, status FROM cameras").fetchall()
print("Updated camera records in DB:")
for c in cameras:
    print(" ", c)

conn.close()
