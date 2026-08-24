import os

class Settings:
    PROJECT_NAME: str = "IBVAP Backend"
    VERSION: str = "1.0.0-SIH"
    API_V1_STR: str = "/api/v1"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./ibvap.db")
    STORAGE_DIR: str = os.getenv("STORAGE_DIR", "./storage")
    
    # SmartAlert Configurations
    SMART_ALERT_MIN_CONF: float = float(os.getenv("SMART_ALERT_MIN_CONF", "0.35"))
    SMART_ALERT_MIN_FRAMES: int = int(os.getenv("SMART_ALERT_MIN_FRAMES", "3"))
    SMART_ALERT_DUPLICATE_WINDOW: float = float(os.getenv("SMART_ALERT_DUPLICATE_WINDOW", "60.0"))
    
    # BorderThreat Engine Configurations
    THREAT_HUMAN_WEIGHT: int = int(os.getenv("THREAT_HUMAN_WEIGHT", "20"))
    THREAT_VEHICLE_WEIGHT: int = int(os.getenv("THREAT_VEHICLE_WEIGHT", "30"))
    THREAT_GROUP_WEIGHT: int = int(os.getenv("THREAT_GROUP_WEIGHT", "35"))
    THREAT_ZONE_BREACH_WEIGHT: int = int(os.getenv("THREAT_ZONE_BREACH_WEIGHT", "40"))
    THREAT_NIGHT_WEIGHT: int = int(os.getenv("THREAT_NIGHT_WEIGHT", "15"))
    THREAT_PERSISTENT_TRACK_WEIGHT: int = int(os.getenv("THREAT_PERSISTENT_TRACK_WEIGHT", "10"))
    THREAT_REPEATED_APPROACH_WEIGHT: int = int(os.getenv("THREAT_REPEATED_APPROACH_WEIGHT", "5"))
    
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "*"
    ]

settings = Settings()

