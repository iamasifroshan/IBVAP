import json
import os

transcript_path = r"C:\Users\Asifroshan\.gemini\antigravity-ide\brain\75ff203d-2856-4dd2-a97f-50b41e800aaa\.system_generated\logs\transcript.jsonl"

print("Reading transcript...")
last_user_input = None
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"type":"USER_INPUT"' in line:
            last_user_input = line

if last_user_input:
    data = json.loads(last_user_input)
    print("Found USER_INPUT step:", data.get("step_index"))
    print("Keys in USER_INPUT:", list(data.keys()))
    if "files" in data:
        print("Files:", data["files"])
    if "attachments" in data:
        print("Attachments:", data["attachments"])
    # Look for any paths or filenames mentioned
    content = str(data.get("content", ""))
    print("Content preview:", content[:300])
