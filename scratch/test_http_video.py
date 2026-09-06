import urllib.request
import urllib.error

urls = [
    "http://localhost:8000/videos/gettyimages-2215078536-640_adpp.mp4",
    "http://localhost:8000/videos/gettyimages-2213890215-640_adpp.mp4",
    "http://localhost:8000/videos/12522257-hd_1920_1080_24fps.mp4",
    "http://localhost:8000/videos/17502678-hd_1080_1920_30fps.mp4"
]

print("=== Testing HTTP 200 GET ===")
for url in urls:
    req = urllib.request.Request(url, headers={"Origin": "http://localhost:5173"})
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"URL: {url}")
            print(f"  Status: {resp.status}")
            print(f"  Content-Type: {resp.headers.get('Content-Type')}")
            print(f"  Content-Length: {resp.headers.get('Content-Length')}")
            print(f"  Accept-Ranges: {resp.headers.get('Accept-Ranges')}")
            print(f"  Access-Control-Allow-Origin: {resp.headers.get('Access-Control-Allow-Origin')}")
            first_bytes = resp.read(16)
            print(f"  First 16 bytes: {first_bytes.hex()}")
    except Exception as e:
        print(f"URL: {url} ERROR: {e}")

print("\n=== Testing Range Request (bytes=0-1023) ===")
for url in urls:
    req = urllib.request.Request(url, headers={"Range": "bytes=0-1023", "Origin": "http://localhost:5173"})
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"URL: {url}")
            print(f"  Status: {resp.status}")
            print(f"  Content-Type: {resp.headers.get('Content-Type')}")
            print(f"  Content-Length: {resp.headers.get('Content-Length')}")
            print(f"  Content-Range: {resp.headers.get('Content-Range')}")
            print(f"  Accept-Ranges: {resp.headers.get('Accept-Ranges')}")
            bytes_read = resp.read()
            print(f"  Bytes received: {len(bytes_read)}")
    except Exception as e:
        print(f"URL: {url} ERROR: {e}")
