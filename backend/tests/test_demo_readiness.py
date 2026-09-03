import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app
import main

@pytest.fixture
def clean_startup():
    # Ensure backend starts clean
    main.is_backend_ready = False
    
    # Reset AI globals to prevent contamination from previous tests
    from ai.detector import detector_instance
    from services.face_recognition import face_recognition_service
    
    # Save original states
    orig_yolo = getattr(detector_instance, "_is_loaded", False)
    orig_face = getattr(face_recognition_service, "initialized", False)
    
    # Force to uninitialized for startup tests
    detector_instance._is_loaded = False
    face_recognition_service.initialized = False
    
    yield
    
    main.is_backend_ready = False
    # Restore original states
    detector_instance._is_loaded = orig_yolo
    face_recognition_service.initialized = orig_face

class TestDemoReadiness:
    @patch("ai.detector.detector_instance.load_model")
    @patch("services.face_recognition.face_recognition_service.load_models")
    def test_backend_startup_succeeds(self, mock_sface, mock_yolo, clean_startup):
        """
        Test 1: Backend startup succeeds with normal dependencies.
        Test 6: Startup state is accurately reflected by /health.
        """
        with TestClient(app) as client:
            assert main.is_backend_ready is True
            
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert data["ready"] is True
            assert data["database"] == "healthy"

    @patch("ai.detector.detector_instance.load_model")
    @patch("services.face_recognition.face_recognition_service.load_models")
    def test_ai_initialization_failure_safe(self, mock_sface, mock_yolo, clean_startup):
        """
        Test 2: AI initialization failure is reported safely.
        Test 4: Health endpoint remains available after non-critical AI failure.
        """
        mock_yolo.side_effect = Exception("Missing weights")
        mock_sface.side_effect = Exception("Missing YuNet weights")
        
        with TestClient(app) as client:
            # Backend should still be ready even if AI failed
            assert main.is_backend_ready is True
            
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            
            # Application degrades but stays up
            assert data["ai_subsystems"]["overall"] == "DEGRADED"

    @patch("ai.detector.detector_instance.load_model")
    @patch("services.face_recognition.face_recognition_service.load_models")
    @patch("main.engine.connect")
    def test_database_connection_failure(self, mock_db, mock_sface, mock_yolo, clean_startup):
        """
        Test: A critical database failure during lifespan degrades health but doesn't crash the API.
        """
        mock_db.side_effect = Exception("DB Timeout")
        
        # TestClient will still successfully yield if lifespan catches the exception
        # Wait, the lifespan catches it via try-except
        with TestClient(app) as client:
            # wait, if engine.connect() fails in lifespan, the exception IS caught in main.py lifespan
            # so is_backend_ready stays False, because it's at the end of the try block.
            assert main.is_backend_ready is False
            
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "offline"
            assert data["ready"] is False

    @patch("os.path.exists")
    def test_missing_storage_handled_safely(self, mock_exists):
        """
        Test 3: Missing storage is handled safely.
        """
        # Testing stream manager handles missing video paths safely without crashing
        from video.stream_manager import StreamSourceManager
        mock_exists.return_value = False
        resolved = StreamSourceManager.resolve_video_path("non_existent.mp4")
        assert resolved is None
        
        status = StreamSourceManager.verify_camera_source("non_existent.mp4")
        assert status["status"] == "OFFLINE"

    def test_no_production_db_access(self):
        """
        Test 7: No production database access occurs during tests.
        """
        from config import settings
        # The test suite uses conftest to override DATABASE_URL to memory
        assert ":memory:" in settings.DATABASE_URL
