import os
import sys

target = "0e7f0d77-740f-4181-bfe8-2676559883b7"

def search_dir(base_dir, max_depth=6):
    if not os.path.exists(base_dir):
        return
    print(f"Scanning: {base_dir}", flush=True)
    base_depth = base_dir.rstrip(os.sep).count(os.sep)
    for root, dirs, files in os.walk(base_dir):
        depth = root.count(os.sep) - base_depth
        if depth > max_depth:
            dirs.clear()
            continue
        # prune
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", "Windows", "System32", "$Recycle.Bin")]
        for f in files:
            if target in f:
                p = os.path.join(root, f)
                print(f"FOUND MATCH: {p} ({os.path.getsize(p)} bytes)", flush=True)

# 1. Check AppData Temp
search_dir(os.environ.get("TEMP", r"C:\Users\Asifroshan\AppData\Local\Temp"))

# 2. Check .gemini
search_dir(r"C:\Users\Asifroshan\.gemini")

# 3. Check Downloads
search_dir(r"C:\Users\Asifroshan\Downloads")

# 4. Check Desktop
search_dir(r"C:\Users\Asifroshan\Desktop")

# 5. Check e:\IBVAP
search_dir(r"e:\IBVAP")

# 6. Check AppData\Local
search_dir(r"C:\Users\Asifroshan\AppData\Local\Google")

# 7. Check AppData\Roaming
search_dir(r"C:\Users\Asifroshan\AppData\Roaming")

print("Done scanning targeted directories.", flush=True)
