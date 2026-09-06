import sys
sys.path.insert(0, 'backend')
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
resp = client.get('/api/v1/incidents')
print('Status:', resp.status_code)
data = resp.json()
print('Total incidents returned:', len(data))
print('Top 5 most recent incidents:')
for inc in data[:5]:
    print(f"  ID: {inc['id']} | Time: {inc['timestamp']} | Snapshot: {inc['snapshotUrl']}")
    if inc['snapshotUrl']:
        img_resp = client.get(inc['snapshotUrl'])
        print(f"    -> Image fetch status: {img_resp.status_code}, length: {len(img_resp.content)} bytes, content-type: {img_resp.headers.get('content-type')}")
