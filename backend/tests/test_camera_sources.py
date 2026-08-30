"""
Tests for StreamSourceManager — real camera source verification.
Validates:
  - Source type classification (MP4, WEBCAM, RTSP)
  - Webcam index parsing
  - RTSP credential sanitization
  - Offline status for missing MP4 file
  - Health score ranges
"""
import sys
import os
import unittest

# Add backend root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from video.stream_manager import StreamSourceManager, SOURCE_WEBCAM, SOURCE_RTSP, SOURCE_SIMULATED


# ─────────────────────────────────────────────────────────────────────────────
# Source type classification tests
# ─────────────────────────────────────────────────────────────────────────────

class TestClassifySource(unittest.TestCase):
    def test_mp4_extension(self):
        self.assertEqual(StreamSourceManager.classify_source("/data/video.mp4"), SOURCE_SIMULATED)

    def test_mp4_extension_uppercase_path(self):
        self.assertEqual(StreamSourceManager.classify_source("C:\\videos\\clip.mp4"), SOURCE_SIMULATED)

    def test_avi_extension(self):
        self.assertEqual(StreamSourceManager.classify_source("/data/video.avi"), SOURCE_SIMULATED)

    def test_webcam_digit(self):
        self.assertEqual(StreamSourceManager.classify_source("0"), SOURCE_WEBCAM)

    def test_webcam_digit_1(self):
        self.assertEqual(StreamSourceManager.classify_source("1"), SOURCE_WEBCAM)

    def test_webcam_colon_prefix(self):
        self.assertEqual(StreamSourceManager.classify_source("webcam:0"), SOURCE_WEBCAM)

    def test_camera_colon_prefix(self):
        self.assertEqual(StreamSourceManager.classify_source("camera:2"), SOURCE_WEBCAM)

    def test_dev_video(self):
        self.assertEqual(StreamSourceManager.classify_source("/dev/video0"), SOURCE_WEBCAM)

    def test_rtsp_scheme(self):
        self.assertEqual(StreamSourceManager.classify_source("rtsp://192.168.1.10:554/live"), SOURCE_RTSP)

    def test_rtsps_scheme(self):
        self.assertEqual(StreamSourceManager.classify_source("rtsps://cam.example.com/stream"), SOURCE_RTSP)

    def test_http_stream(self):
        self.assertEqual(StreamSourceManager.classify_source("http://cam.local:8080/mjpeg"), SOURCE_RTSP)

    def test_empty_defaults_to_mp4(self):
        self.assertEqual(StreamSourceManager.classify_source(""), SOURCE_SIMULATED)


# ─────────────────────────────────────────────────────────────────────────────
# Webcam index parsing tests
# ─────────────────────────────────────────────────────────────────────────────

class TestParseWebcamIndex(unittest.TestCase):
    def test_digit_string(self):
        self.assertEqual(StreamSourceManager.parse_webcam_index("0"), 0)
        self.assertEqual(StreamSourceManager.parse_webcam_index("1"), 1)
        self.assertEqual(StreamSourceManager.parse_webcam_index("2"), 2)

    def test_webcam_prefix(self):
        self.assertEqual(StreamSourceManager.parse_webcam_index("webcam:0"), 0)
        self.assertEqual(StreamSourceManager.parse_webcam_index("webcam:1"), 1)

    def test_camera_prefix(self):
        self.assertEqual(StreamSourceManager.parse_webcam_index("camera:2"), 2)

    def test_dev_video(self):
        self.assertEqual(StreamSourceManager.parse_webcam_index("/dev/video0"), 0)
        self.assertEqual(StreamSourceManager.parse_webcam_index("/dev/video1"), 1)

    def test_default_fallback(self):
        self.assertEqual(StreamSourceManager.parse_webcam_index("unknown"), 0)


# ─────────────────────────────────────────────────────────────────────────────
# RTSP credential sanitization tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSanitizeRtspUrl(unittest.TestCase):
    def test_sanitizes_password(self):
        url = "rtsp://admin:mysecret@192.168.1.10:554/live"
        sanitized = StreamSourceManager.sanitize_rtsp_url(url)
        self.assertNotIn("mysecret", sanitized)
        self.assertIn("***", sanitized)

    def test_no_credentials(self):
        url = "rtsp://192.168.1.10:554/live"
        sanitized = StreamSourceManager.sanitize_rtsp_url(url)
        self.assertIn("192.168.1.10", sanitized)

    def test_sanitized_keeps_username(self):
        url = "rtsp://admin:pass@host:554/stream"
        sanitized = StreamSourceManager.sanitize_rtsp_url(url)
        self.assertIn("admin", sanitized)
        self.assertNotIn("pass", sanitized)


# ─────────────────────────────────────────────────────────────────────────────
# Source verification tests (offline/real logic — no cameras required)
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyCameraSource(unittest.TestCase):
    def test_mp4_missing_file_returns_offline(self):
        result = StreamSourceManager.verify_camera_source(
            "/nonexistent/video.mp4", SOURCE_SIMULATED
        )
        # Verify status mapping (uppercase)
        self.assertEqual(result["status"], "OFFLINE")
        self.assertEqual(result["health_score"], 0)
        self.assertIsNotNone(result["error"])
        self.assertIn("not found", result["error"].lower())

    def test_mp4_empty_url_returns_offline(self):
        result = StreamSourceManager.verify_camera_source("", SOURCE_SIMULATED)
        self.assertEqual(result["status"], "OFFLINE")

    def test_health_score_range(self):
        result = StreamSourceManager.verify_camera_source(
            "/nonexistent/file.mp4", SOURCE_SIMULATED
        )
        self.assertTrue(0 <= result["health_score"] <= 100)

    def test_offline_returns_zero_dimensions(self):
        result = StreamSourceManager.verify_camera_source(
            "/nonexistent/file.mp4", SOURCE_SIMULATED
        )
        self.assertEqual(result["width"], 0)
        self.assertEqual(result["height"], 0)
        self.assertEqual(result["fps"], 0.0)

    def test_offline_result_has_all_required_keys(self):
        result = StreamSourceManager.verify_camera_source(
            "/nonexistent/file.mp4", SOURCE_SIMULATED
        )
        required_keys = {"status", "source_type", "error", "health_score",
                         "width", "height", "fps", "resolution", "sanitized_url"}
        self.assertTrue(required_keys.issubset(result.keys()))

    def test_rtsp_unreachable_returns_offline(self):
        result = StreamSourceManager.verify_camera_source(
            "rtsp://127.0.0.1:1/nosuchstream", SOURCE_RTSP, test_frames=1
        )
        self.assertIn(result["status"], ("OFFLINE", "DEGRADED"))
        self.assertLess(result["health_score"], 100)

    def test_sanitized_url_rtsp_hides_creds(self):
        result = StreamSourceManager.verify_camera_source(
            "rtsp://user:secretpass@127.0.0.1:1/stream", SOURCE_RTSP, test_frames=1
        )
        self.assertNotIn("secretpass", result["sanitized_url"])


# ─────────────────────────────────────────────────────────────────────────────
# extract_live_frames error handling tests
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractLiveFrames(unittest.TestCase):
    def test_mp4_type_returns_error(self):
        frames, video_id, err = StreamSourceManager.extract_live_frames(
            "/data/video.mp4", SOURCE_SIMULATED, max_frames=5
        )
        self.assertEqual(frames, [])
        self.assertIsNotNone(err)
        self.assertIn("Not a live source", err)

    def test_unreachable_rtsp_returns_empty(self):
        frames, video_id, err = StreamSourceManager.extract_live_frames(
            "rtsp://127.0.0.1:1/nosuchstream", SOURCE_RTSP, max_frames=5
        )
        self.assertEqual(frames, [])
        self.assertIsNotNone(err)


if __name__ == "__main__":
    unittest.main()
