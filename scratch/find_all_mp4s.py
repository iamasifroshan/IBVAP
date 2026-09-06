import os
import sys
import time

today = "2026-09-06"
now = time.time()
three_days_ago = now - 3 * 86400

print(f"Finding all MP4 files created/modified recently...", flush=True)

search_roots = [
    r"C:\Users\Asifroshan",
    r"E:\\"
]

results = []
for sroot in search_roots:
    print(f"Searching {sroot}...", flush=True)
    for root, dirs, files in os.walk(sroot):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", "$Recycle.Bin", "Windows")]
        for f in files:
            if f.lower().endswith(".mp4"):
                fp = os.path.join(root, f)
                try:
                    mt = os.path.getmtime(fp)
                    sz = os.path.getsize(fp)
                    results.append((fp, sz, mt, time.ctime(mt)))
                except Exception:
                    pass

print(f"\nTotal MP4 files found: {len(results)}", flush=True)
print("\nSorted by modification time (newest first):", flush=True)
for fp, sz, mt, tstr in sorted(results, key=lambda x: x[2], reverse=True)[:30]:
    print(f"  {tstr} | {sz:>10} bytes | {fp}", flush=True)
