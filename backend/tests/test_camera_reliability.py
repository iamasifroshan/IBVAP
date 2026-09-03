import pytest
import time
from unittest.mock import MagicMock, patch
import cv2

from ai.detector import YoloDetector
from config import settings

@pytest.fixture
def mock_detector():
    with patch('ai.detector.YoloDetector._validate_model_file'), patch('ai.detector.YoloDetector.load_model'), patch('ai.detector.YoloDetector._resolve_path', return_value='fake.mp4'):
        detector = YoloDetector()
        detector.model = MagicMock()
        detector.model.predictor = None
        # Mock track_frame to return empty results for simplicity
        detector.track_frame = MagicMock(return_value=[])
        yield detector

@pytest.fixture
def mock_settings(monkeypatch):
    monkeypatch.setattr(settings, "CAMERA_RECONNECT_ENABLED", True)
    monkeypatch.setattr(settings, "CAMERA_RECONNECT_MAX_RETRIES", 2)
    monkeypatch.setattr(settings, "CAMERA_RECONNECT_DELAY_SECONDS", 0.0)

def test_initial_camera_open_failure(mock_detector):
    with patch('cv2.VideoCapture') as mock_vc:
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = False
        mock_vc.return_value = mock_cap

        with pytest.raises(ValueError, match="OpenCV failed to open video"):
            mock_detector.process_video_with_tracking("fake.mp4", "cam1")

def test_successful_reconnect(mock_detector, mock_settings):
    with patch('cv2.VideoCapture') as mock_vc:
        # We need mock_vc to return different captures or handle state
        cap1 = MagicMock()
        cap1.isOpened.return_value = True
        cap1.get.return_value = 30.0 # FPS
        cap1.read.side_effect = [(True, MagicMock()), (False, None)]
        
        cap2 = MagicMock()
        cap2.isOpened.return_value = True
        cap2.get.return_value = 30.0
        cap2.read.side_effect = [(True, MagicMock()), (False, None)]
        
        cap3 = MagicMock()
        cap3.isOpened.return_value = True
        cap3.get.return_value = 30.0
        cap3.read.side_effect = [(True, MagicMock()), (False, None)] # Exhaust retries to exit loop smoothly
        
        mock_vc.side_effect = [cap1, cap2, cap3, MagicMock(isOpened=lambda: False)]

        res = mock_detector.process_video_with_tracking("fake.mp4", "cam1", max_frames=2)
        
        assert mock_vc.call_count >= 2
        cap1.release.assert_called_once()
        # Since it successfully reconnected, the final result should show the processed frames
        assert res["frames_analyzed"] > 0

def test_retry_exhaustion(mock_detector, mock_settings):
    with patch('cv2.VideoCapture') as mock_vc:
        cap1 = MagicMock()
        cap1.isOpened.return_value = True
        cap1.get.return_value = 30.0
        cap1.read.side_effect = [(True, MagicMock()), (False, None)]
        
        cap_fail = MagicMock()
        cap_fail.isOpened.return_value = False
        
        # Original cap, then retries
        mock_vc.side_effect = [cap1, cap_fail, cap_fail, cap_fail]

        res = mock_detector.process_video_with_tracking("fake.mp4", "cam1", max_frames=3)
        
        # 1 original + 2 retries (based on max_retries=2)
        assert mock_vc.call_count == 3
        cap1.release.assert_called_once()
        assert res["frames_analyzed"] == 1

def test_opencv_exception_handled(mock_detector, mock_settings):
    with patch('cv2.VideoCapture') as mock_vc:
        cap1 = MagicMock()
        cap1.isOpened.return_value = True
        cap1.get.return_value = 30.0
        # Read raises exception on second call
        cap1.read.side_effect = [(True, MagicMock()), Exception("Mock OpenCV crash!")]
        
        cap2 = MagicMock()
        cap2.isOpened.return_value = True
        cap2.get.return_value = 30.0
        cap2.read.side_effect = [(True, MagicMock()), (False, None)] # then normal EOF
        
        cap3 = MagicMock()
        cap3.isOpened.return_value = False # exhaust retries
        
        mock_vc.side_effect = [cap1, cap2, cap3, cap3]

        res = mock_detector.process_video_with_tracking("fake.mp4", "cam1", max_frames=5)
        
        assert mock_vc.call_count >= 2
        cap1.release.assert_called_once()
        assert res["frames_analyzed"] >= 1
