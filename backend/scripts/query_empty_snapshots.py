import sqlite3
import pandas as pd
conn = sqlite3.connect('backend/ibvap.db')
df = pd.read_sql_query("SELECT incident_id, camera_id, track_id, snapshot_url, timestamp, person_name, threat_level, threat_score FROM incidents", conn)
print(f"Total incidents: {len(df)}")
print(f"Empty snapshot_urls: {len(df[df['snapshot_url'] == ''])}")
print("Incidents with empty snapshot_urls:")
print(df[df['snapshot_url'] == ''].head(10).to_string())
print("Incident for BORDER-CAM-07 TRK#2:")
print(df[(df['camera_id'] == 'BORDER-CAM-07') & (df['track_id'] == 'TRK#2')].to_string())
conn.close()
