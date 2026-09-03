# SIH Demo Script

**Estimated Duration: 5–10 minutes**

## 1. Opening
*Welcome the evaluators and introduce the problem.*
- **Problem being solved:** Conventional surveillance systems are reactive and require constant human monitoring. They lack real-time intelligence at the edge, especially in critical environments like borders or restricted zones.
- **Why conventional surveillance is insufficient:** Standard CCTV relies on manual identification, suffers from high false-alarm rates, and struggles to maintain persistent tracking of individuals across varying lighting or obscurations.
- **IBVAP’s core solution:** The Intelligent Border Video Analytics Platform (IBVAP) brings robust, edge-capable AI to existing camera infrastructure. It provides real-time detection, stable identity tracking, advanced face recognition with confidence scoring, and automated evidence capture—all designed for high reliability and rapid recovery.

## 2. Architecture Overview
*Briefly explain the tech stack while moving to the application.*
- **Input:** RTSP/HTTP camera streams or local video files.
- **Detection & Tracking:** We use YOLO for high-speed person detection, paired with ByteTrack for stable, persistent identity tracking across frames.
- **Biometrics:** YuNet detects faces, and SFace extracts high-dimensional biometric features.
- **Multi-Reference Identity:** The system natively supports multiple face references per person for robust matching under different angles and lighting.
- **Identity Smoothing:** We use Exponential Moving Average (EMA) for bounding boxes and Temporal Identity Smoothing to prevent jitter and flickering.
- **Backend/Frontend:** A lightweight FastAPI REST/WebSocket backend coordinates AI inference and writes to SQLite, while a React/Vite frontend provides real-time situational awareness.

## 3. Live Demonstration

### System Verification (1 minute)
1. **Open Application:** Start at the dashboard or System Verification page.
2. **Show Statuses:** Point out the real-time telemetry.
   - **Backend:** ONLINE
   - **Database:** HEALTHY
   - **Cameras:** ONLINE
   - **AI Subsystems:** YOLO, YuNet, and SFace all READY.

### Biometric Registration (1 minute)
3. **Open Known Persons:** Navigate to the registration page.
4. **Show Asif Profile:** Highlight the pre-registered "Asif" profile. Show that it contains multiple face references for higher accuracy.

### Live Surveillance & Edge AI (3-5 minutes)
5. **Open Live Surveillance:** Select the active camera stream and start inference.
6. **YOLO & ByteTrack:** Point out the bounding box around a person in the frame. Note the tracking ID assigned to them that remains stable as they move.
7. **Face Recognition & Confidence:** Step into the camera view. Observe the system instantly attach the "Asif" identity to the tracking box, alongside a calculated Confidence Level percentage.
8. **Robustness Test (Obscuration):** Turn away from the camera or temporarily obscure the face.
   - Point out that the identity does *not* flicker or drop immediately, thanks to our Temporal Identity Smoothing and tracking integration.
9. **Unknown Detection:** Introduce an unregistered person into the frame. Show how the system explicitly labels them as "UNKNOWN", preventing false positives.
10. **Evidence Capture:** Demonstrate how an incident (like a zone intrusion) triggers the Incident Engine, capturing an automated snapshot and video clip as indisputable evidence.

### Resilience Demonstration (Optional, 1-2 minutes)
11. **Camera/Backend Recovery:** If requested, simulate a camera drop or backend restart.
    - Show the UI gracefully transition to `CONNECTING` or `OFFLINE` without crashing.
    - Restart the backend/stream and observe the WebSocket reconnect and AI inference resume entirely on its own.
