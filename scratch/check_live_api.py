import urllib.request
import json

def check():
    with urllib.request.urlopen('http://localhost:8000/api/v1/incidents') as resp:
        data = json.loads(resp.read().decode())
    print(f"Live API Default (demo_only=True) Count: {len(data)}")
    for item in data[:5]:
        print(f"  {item.get('incident_id')} | {item.get('event_type')} | {item.get('snapshot_url')} | {item.get('persistentId')}")

    with urllib.request.urlopen('http://localhost:8000/api/v1/incidents?all=true') as resp_all:
        data_all = json.loads(resp_all.read().decode())
    print(f"Live API All (all=True) Count: {len(data_all)}")

if __name__ == '__main__':
    check()
