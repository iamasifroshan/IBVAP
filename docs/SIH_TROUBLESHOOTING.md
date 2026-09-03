# IBVAP SIH Troubleshooting Guide

This guide covers common issues that may arise during the SIH demonstration and provides safe, evaluator-friendly recovery actions.

**CRITICAL RULE:** Do NOT delete or modify the production database (`backend/ibvap.db`) during the demo to "fix" an issue. 

---

### Backend does not start
- **Symptom:** `npm run dev:all` fails to launch the Python backend, or the terminal shows an immediate crash.
- **Likely Cause:** Python environment not activated, missing dependencies, or port 8000 is occupied.
- **Recovery Action:** Verify the `.venv` is active. Run `Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force` to kill stuck zombie processes, then restart.

### Frontend shows CONNECTING
- **Symptom:** UI displays a yellow "CONNECTING" banner indefinitely.
- **Likely Cause:** The backend is starting up AI models (which can take 5-15 seconds) or the frontend booted before the backend API became available.
- **Recovery Action:** Wait 15 seconds. If it does not transition to ONLINE, check the backend terminal for the `[STARTUP] API ready` log. Refresh the browser if necessary.

### Frontend shows OFFLINE
- **Symptom:** UI displays a red "OFFLINE" banner during normal operation.
- **Likely Cause:** The FastAPI backend crashed or the WebSocket connection dropped.
- **Recovery Action:** The frontend has automatic exponential backoff. Check the backend terminal. If the backend crashed, restart it with `npm run dev:all`. The frontend will automatically recover and transition to ONLINE.

### Camera unavailable or Camera reconnecting
- **Symptom:** Live Surveillance shows a black screen, or System Verification reports a camera as OFFLINE.
- **Likely Cause:** The RTSP stream dropped, the MP4 file is missing, or network latency timed out the OpenCV VideoCapture.
- **Recovery Action:** The backend has built-in retry logic (`CAMERA_RECONNECT_ENABLED = True`). Simply wait for the retry cycle. If it's a physical webcam, ensure no other application (like Zoom/Teams) is holding the hardware lock.

### YOLO / YuNet / SFace not ready
- **Symptom:** System Verification shows AI status as ERROR or DEGRADED.
- **Likely Cause:** Missing `.onnx` model weights in the `backend/models/` directory, or corrupted files.
- **Recovery Action:** Ensure the models are downloaded and placed in the correct directory. The backend degrades gracefully so it won't crash, but inference will not work until models are restored and the backend is restarted.

### Asif appears UNKNOWN
- **Symptom:** The known subject is standing in frame but the bounding box says UNKNOWN.
- **Likely Cause:** The face is completely obscured, lighting is drastically different, or the subject's face isn't facing the camera enough for YuNet to capture a high-quality crop.
- **Recovery Action:** Look directly at the camera in good lighting. If the issue persists, go to Known Persons, click the profile, and add a new Face Reference using the current lighting conditions.

### Bounding box jitter
- **Symptom:** The bounding box rapidly flickers or jumps slightly.
- **Likely Cause:** Extreme CPU load causing frame drops, or tracking ID swapping.
- **Recovery Action:** Our EMA (Exponential Moving Average) smoothing should prevent this. If it occurs, it indicates the tracking engine is starved for CPU. Close unnecessary background applications on the demo machine.

### Low FPS / Excessive Latency
- **Symptom:** The video feed is visibly lagging behind real-time.
- **Likely Cause:** Hardware limitations. YOLO and Face Recognition are running on CPU without hardware acceleration.
- **Recovery Action:** Do not run multiple simultaneous camera inference streams during the demo unless the host machine is powerful. Stick to one active Live Surveillance feed.

### WebSocket disconnected / Port already in use
- **Symptom:** Terminal says `[Errno 98] Address already in use` or WebSocket fails to connect.
- **Likely Cause:** A previous instance of the backend wasn't shut down cleanly.
- **Recovery Action:** Terminate the node and python processes. On Windows PowerShell: `Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Stop-Process -Force`.
