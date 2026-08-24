from fastapi import APIRouter

router = APIRouter(prefix="/streams", tags=["Streams"])

@router.get("")
def get_active_streams():
    return [
        {"camera_id": "BORDER-CAM-07", "protocol": "IP_CCTV", "status": "active", "fps": 30},
        {"camera_id": "SECTOR-B-CAM-03", "protocol": "RTSP", "status": "active", "fps": 25},
        {"camera_id": "BOP-NORTH-02", "protocol": "IP_CCTV", "status": "active", "fps": 30},
    ]
