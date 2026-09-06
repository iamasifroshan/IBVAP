import urllib.request

url = "http://localhost:8000/videos/gettyimages-2215078536-640_adpp.mp4"

# 1. Standard GET
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as resp:
    print("Standard GET:")
    print(f"  Status: {resp.status}")
    print(f"  Content-Type: {resp.headers.get('Content-Type')}")
    print(f"  Content-Length: {resp.headers.get('Content-Length')}")
    print(f"  Accept-Ranges: {resp.headers.get('Accept-Ranges')}")

# 2. Range GET
req2 = urllib.request.Request(url, headers={"Range": "bytes=0-1023"})
with urllib.request.urlopen(req2) as resp2:
    print("\nRange GET (bytes=0-1023):")
    print(f"  Status: {resp2.status}")
    print(f"  Content-Range: {resp2.headers.get('Content-Range')}")
    print(f"  Content-Length: {resp2.headers.get('Content-Length')}")
    data = resp2.read()
    print(f"  Bytes read: {len(data)}")
