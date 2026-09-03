# IBVAP System Architecture

This document outlines the actual implemented architecture of the Intelligent Border Video Analytics Platform (IBVAP). It emphasizes edge-capable processing, real-time analytics, and operational resilience.

## High-Level Data Flow

```
Frontend (React/Vite)
       ↓↑ (REST / WebSockets)
FastAPI Backend (Python)
       ↓
Camera/Input Layer (OpenCV VideoCapture)
       ↓
YOLO (Person Detection)
       ↓
ByteTrack (Identity Tracking)
       ↓
Face Detection (YuNet)
       ↓
Face Recognition (SFace)
       ↓
Identity Smoothing & Bounding Box EMA
       ↓
Incident Engine & Threat Scoring
       ↓
Evidence Capture (Snapshots/Clips)
       ↓
SQLite Database (Persistence)
```

## Component Responsibilities

### 1. Frontend (React + Vite)
- Provides real-time situational awareness (Live Surveillance).
- Manages biometric profiles (Known Persons).
- Handles system telemetry and connection resiliency (System Verification).
- Uses long-polling and WebSockets to receive inference streams and system health updates.

### 2. FastAPI Backend & API Layer
- Serves as the central orchestrator.
- Manages lifecycle (`lifespan` context) to load AI models explicitly at startup.
- Exposes REST endpoints for configuration, biometrics, and incident retrieval.
- Manages WebSocket connections for real-time inference streaming.

### 3. Camera / Input Layer
- Uses OpenCV to capture frames from RTSP streams, HTTP streams, or local MP4 files.
- Implements robust reconnection logic with exponential backoff if the stream drops.

### 4. YOLO (Detection)
- The first AI stage in the inference pipeline.
- Scans the raw frame to detect "person" objects at high speeds, producing initial bounding boxes and confidence scores.

### 5. ByteTrack (Tracking)
- Associates YOLO bounding boxes across sequential frames.
- Assigns persistent, stable Track IDs to individuals, allowing the system to remember who is who even if a face is temporarily obscured.

### 6. Face Detection (YuNet) & Recognition (SFace)
- When a tracked person's face is visible, YuNet extracts the face crop.
- SFace computes a high-dimensional feature vector (biometric embedding).
- The embedding is compared against multiple reference templates stored in the SQLite database (Multi-Reference Recognition) using Cosine Similarity.
- Returns a matched identity (or UNKNOWN) and a confidence score.

### 7. Identity Smoothing & Bounding Box EMA
- **Temporal Identity Smoothing:** Prevents identity flickering by maintaining a grace period for lost faces. If the tracker still sees the person, their identity is preserved until the grace period expires.
- **Bounding Box EMA:** Uses Exponential Moving Average (EMA) to smooth the visual bounding box coordinates, eliminating rendering jitter between raw detection cycles.

### 8. Incident Engine & Evidence Capture
- Evaluates tracks against virtual fences and exclusion zones.
- Calculates Threat Scores based on zone type, identity (Known vs. Unknown), and time of day.
- Generates localized incidents in the SQLite database.
- Saves raw frame snapshots and short video clips locally as cryptographic evidence.

### 9. SQLite Database
- A lightweight, serverless relational database.
- Stores biometric embeddings, registered persons, cameras, zones, incidents, and system configuration.
- Completely isolated during automated testing (via `conftest.py` in-memory mocks) to ensure production safety.
