import os
import sys
import time

target_uuid = "0e7f0d77"
target_name = "0e7f0d77-740f-4181-bfe8-2676559883b7.mp4"

now = time.time()
one_day_ago = now - 24 * 3600

print(f"Searching for {target_name} or recently created MP4 files...")

search_dirs = [
    r"E:\IBVAP",
    "E:\\",
    r"C:\Users\Asifroshan",
    r"C:\Users\Asifroshan\.gemini",
    r"C:\Users\Asifroshan\AppData\Local",
    r"C:\Users\Asifroshan\AppData\Roaming",
    r"C:\Users\Asifroshan\Downloads",
    r"C:\Users\Asifroshan\Desktop",
    r"C:\Users\Asifroshan\Videos",
    r"C:\Users\Asifroshan\Documents",
]

found_exact = []
recent_mp4s = []

for sdir in search_dirs:
    if not os.path.exists(sdir):
        continue
    print(f"Scanning {sdir} ...")
    try:
        for root, dirs, files in os.walk(sdir):
            # Skip heavy dirs
            if "node_modules" in dirs:
                dirs.remove("node_modules")
            if ".git" in dirs:
                dirs.remove(".git")
            if ".venv" in dirs:
                dirs.remove(".venv")
            if "$RECYCLE.BIN" in dirs:
                dirs.remove("$RECYCLE.BIN")

            for f in files:
                f_lower = f.lower()
                if target_uuid in f_lower:
                    full_path = os.path.join(root, f)
                    found_exact.append(full_path)
                    print(f"EXACT MATCH FOUND: {full_path}")
                elif f_lower.endswith(".mp4"):
                    full_path = os.path.join(root, f)
                    try:
                        mtime = os.path.getmtime(full_path)
                        if mtime > one_day_ago:
                            recent_mp4s.append((full_path, os.path.getsize(full_path), mtime))
                    except Exception:
                        pass
    except Exception as e:
        print(f"Error scanning {sdir}: {e}")

print("\n=== SUMMARY OF EXACT MATCHES ===")
for p in found_exact:
    print(f"  {p} ({os.path.getsize(p)} bytes)")

print("\n=== RECENT MP4 FILES (Last 24h) ===")
for p, sz, mt in sorted(recent_mp4s, key=lambda x: x[2], reverse=True)[:20]:
    print(f"  {p} | Size: {sz} bytes | MTime: {time.ctime(mt)}")
