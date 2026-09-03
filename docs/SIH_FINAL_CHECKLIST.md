# IBVAP Final SIH Demo Checklist

Use this checklist during the final presentation preparation to ensure all components are verified and ready for evaluators.

## 1. Before Presentation
- [ ] **Backend starts:** `npm run dev:all` executes without errors.
- [ ] **Frontend starts:** UI loads at `http://localhost:5173`.
- [ ] **System Verification healthy:** Dashboard shows ONLINE.
- [ ] **Camera online:** At least one active input source is available.
- [ ] **YOLO ready:** System Verification confirms YOLO loaded.
- [ ] **YuNet ready:** System Verification confirms YuNet loaded.
- [ ] **SFace ready:** System Verification confirms SFace loaded.
- [ ] **Asif profile present:** Known Persons page displays the target profile.
- [ ] **Face references present:** The profile contains >=1 valid face embeddings.
- [ ] **Live Surveillance verified:** Inference stream opens without crashing.
- [ ] **Incident/evidence verified:** Database contains past incidents, proving read/write works.

## 2. During Presentation
- [ ] **Explain problem:** Outline the need for edge-capable intelligent border analytics.
- [ ] **Explain architecture:** Show the data flow from Camera → YOLO → Tracking → Biometrics → Evidence.
- [ ] **Demonstrate detection:** Show YOLO capturing bounding boxes.
- [ ] **Demonstrate tracking:** Show ByteTrack maintaining ID numbers.
- [ ] **Demonstrate face recognition:** Step into frame and be recognized.
- [ ] **Demonstrate confidence:** Point out the % confidence score.
- [ ] **Demonstrate UNKNOWN:** Have an unregistered person step into frame.
- [ ] **Demonstrate incident/evidence:** Cross a virtual boundary or trigger a threat alert; show the resulting evidence snapshot.
- [ ] **Demonstrate recovery (if appropriate):** Stop the backend, observe the UI fallback, and restart it to show automatic recovery.

## 3. Emergency Recovery
- [ ] **Backend restart procedure:** Know how to cleanly kill and restart `npm run dev:all`.
- [ ] **Camera reconnect procedure:** Let the system's exponential backoff handle it automatically.
- [ ] **Frontend refresh procedure:** F5 is safe; the UI will pull the latest backend state.
- [ ] **Verify database remains untouched:** Keep a backup of `backend/ibvap.db` before the demo just in case, but NEVER delete it to "fix" a bug during the presentation.
