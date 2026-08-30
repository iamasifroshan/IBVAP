import json
with open('E:\\IBVAP\\backend\\storage\\sector-b-detect3.json', encoding='utf-16') as f:
    data = json.load(f)
print('Total Detections:', data.get('total_detections'))
print('Incidents Created:', data.get('incidents_created_count'))
if data.get('incidents_created'):
    print('Incidents:', json.dumps(data['incidents_created'], indent=2))
else:
    print('No incidents created.')

print('\nTracks Summary:')
for t in data.get('tracks', []):
    print(t)

if data.get('detections'):
    print('\nFirst 2 detections:')
    print(json.dumps(data['detections'][:2], indent=2))

if data.get('detections'):
    print('\nFirst 2 detections:')
    print(json.dumps(data['detections'][:2], indent=2))
