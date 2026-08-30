import sqlite3
import uuid
import datetime
import json

conn = sqlite3.connect('E:\\IBVAP\\backend\\ibvap.db')
cursor = conn.cursor()
zone_id = str(uuid.uuid4())
poly = json.dumps([{"x": 0.0, "y": 0.0}, {"x": 100.0, "y": 0.0}, {"x": 100.0, "y": 100.0}, {"x": 0.0, "y": 100.0}])

cursor.execute('''
UPDATE zones SET polygon_coordinates = ? WHERE camera_id = 'SECTOR-B-CAM-03'
''', (poly,))

conn.commit()
conn.close()
