import os
import sys

target = "0e7f0d77"
print(f"Searching C:\\ for any file containing {target}...", flush=True)

for root, dirs, files in os.walk("C:\\"):
    dirs[:] = [d for d in dirs if d not in ("Windows", "Program Files", "Program Files (x86)", "$Recycle.Bin", ".git", "node_modules")]
    for f in files:
        if target in f.lower():
            p = os.path.join(root, f)
            print(f"FOUND: {p} ({os.path.getsize(p)} bytes)", flush=True)

print("Search complete.", flush=True)
