# IBVAP Phase 5 — SIH Demo Checklist

This is a concise, evaluator-friendly sequence for demonstrating IBVAP's resilience, functionality, and performance during an SIH evaluation.

## 1. Before Demo (Startup & Verification)
- [ ] Start the application using `npm run dev:all`.
- [ ] Observe terminal startup logs. Confirm `[STARTUP]` tags appear for Database, Cameras, AI (YOLO, YuNet, SFace), Storage, and API.
- [ ] Open the frontend (http://localhost:5173).
- [ ] Verify the UI briefly shows **CONNECTING** and then transitions smoothly to **ONLINE**.
- [ ] Navigate to **System Verification**.
- [ ] Confirm Backend is **ONLINE**, Database is **HEALTHY**, and AI Subsystems (YOLO, YuNet, SFace) are **READY**.
- [ ] Confirm active camera streams and acceptable memory/uptime metrics.
- [ ] Navigate to **Known Persons** and verify the "Asif" profile exists and has associated face references.

## 2. During Demo (Surveillance & Features)
- [ ] Open **Live Surveillance**.
- [ ] Select a camera stream and start inference.
- [ ] **YOLO Detection:** Point out that people are accurately detected with bounding boxes.
- [ ] **Stable Tracking:** Note the consistent ByteTrack ID assigned to individuals as they move.
- [ ] **Asif Recognition:** Step into the camera view. Observe the face bounding box smoothly appear and label the person as "Asif".
- [ ] **Confidence Level:** Note the confidence percentage displayed alongside the name.
- [ ] **Movement & Obscuration:** Move around, turn away, and turn back.
  - Box follows smoothly (no jitter).
  - Identity does not flicker instantly (Temporal Identity Smoothing).
  - System correctly returns to "UNKNOWN" when face is fully lost for the grace period, then recovers instantly when the face is visible again.
- [ ] **Incidents/Evidence:** Trigger an incident (e.g., Virtual Fence crossing). Verify an incident is generated in the UI and a snapshot/video clip is available.

## 3. Resilience & Recovery (The "Hardening" Demo)
- [ ] **Camera Recovery:** Temporarily disable/disconnect a camera stream.
  - Observe the camera state become **OFFLINE** in System Verification.
  - Reconnect the stream. Observe the automatic recovery and resumption of tracking without needing to refresh the page.
- [ ] **Backend Recovery:** Stop the backend server while Live Surveillance is active.
  - Observe the frontend gracefully switch to **CONNECTING** / **OFFLINE**.
  - Notice that API requests halt (no console spamming).
  - Restart the backend. Observe the UI automatically switch back to **ONLINE**, the WebSocket reconnect, and inference seamlessly resume.

## 4. Final Safety (Evaluator Check)
- [ ] **Database Integrity:** Prove that the production SQLite database (`backend/ibvap.db`) remains intact, and test cases run safely against isolated memory databases.
- [ ] **Clean Console:** Show the browser console is free from red error spam or unhandled rejections during normal operation.
- [ ] **Tests Green:** Run `npm run build` and `pytest backend/tests -v` to prove the system's structural integrity is 100% passing.
