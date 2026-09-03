import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from unittest.mock import patch

from main import app, engine
from database.db import Base
from video.stream_manager import StreamSourceManager

# We use the isolated test engine via dependency injection in conftest,
# but for main app health check which uses `engine.connect()`, we can mock it
# to simulate db failure.

@pytest.fixture
def client():
    # Setup / Teardown is managed by conftest.py isolated DB
    with TestClient(app) as client:
        yield client

class TestConnectionRecovery:
    def test_health_endpoint_success(self, client):
        """
        Verify the health endpoint succeeds normally when the DB is connected.
        """
        # Set the global `is_backend_ready` flag used in main.py for tests
        import main
        main.is_backend_ready = True
        
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["database"] == "healthy"
        assert data["ready"] is True

    @patch("main.engine.connect")
    def test_health_endpoint_db_failure(self, mock_connect, client):
        """
        Verify the health endpoint degrades gracefully when the database connection fails,
        without crashing the server.
        """
        import main
        main.is_backend_ready = True
        
        # Simulate a database connection failure
        mock_connect.side_effect = Exception("DB Connection Timeout")
        
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        
        # Should drop to degraded state
        assert data["status"] == "degraded"
        assert data["database"] == "error"
        
        # Restore mock to ensure other tests don't fail
        mock_connect.side_effect = None

    def test_camera_verify_offline_recovery(self):
        """
        Verify that testing an unreachable stream URL returns OFFLINE gracefully
        and does not permanently crash or hang the Stream Manager.
        """
        unreachable_url = "rtsp://192.0.2.1:554/dead-stream"
        
        # Act
        result = StreamSourceManager.verify_camera_source(unreachable_url, source_type="RTSP")
        
        # Assert
        assert result["status"] == "OFFLINE"
        assert result["health_score"] == 0
        assert "error" in result

    def test_camera_verify_simulated_file_recovery(self):
        """
        Verify that missing simulated files correctly return OFFLINE without crashing.
        """
        missing_file = "non_existent_video_123.mp4"
        
        # Act
        result = StreamSourceManager.verify_camera_source(missing_file, source_type="SIMULATED_FILE")
        
        # Assert
        assert result["status"] == "OFFLINE"
        assert result["health_score"] == 0
        assert "error" in result
        assert "not found" in result["error"].lower()

