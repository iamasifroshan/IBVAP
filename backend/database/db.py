import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from config import settings

connect_args = {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}

engine = create_engine(
    settings.DATABASE_URL, connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def run_migrations():
    """
    Runs SQLite database migrations dynamically to add missing columns in ZoneModel
    without destroying existing database tables or records.
    """
    import sqlite3
    db_url = settings.DATABASE_URL
    if not db_url.startswith("sqlite:///"):
        return
        
    db_path = db_url.replace("sqlite:///", "")
    # Resolve relative path if necessary
    if not os.path.isabs(db_path):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        db_path = os.path.normpath(os.path.join(base_dir, db_path))
        
    if not os.path.exists(db_path):
        return
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get existing columns in zones table
        cursor.execute("PRAGMA table_info(zones)")
        columns = [row[1] for row in cursor.fetchall()]
        
        # Add columns if they are not already present
        if "human_detection" not in columns:
            cursor.execute("ALTER TABLE zones ADD COLUMN human_detection BOOLEAN DEFAULT 1")
        if "vehicle_detection" not in columns:
            cursor.execute("ALTER TABLE zones ADD COLUMN vehicle_detection BOOLEAN DEFAULT 0")
        if "animal_detection" not in columns:
            cursor.execute("ALTER TABLE zones ADD COLUMN animal_detection BOOLEAN DEFAULT 0")
        if "person_threshold" not in columns:
            cursor.execute("ALTER TABLE zones ADD COLUMN person_threshold INTEGER DEFAULT 1")
            
        # Get existing columns in cameras table
        cursor.execute("PRAGMA table_info(cameras)")
        cam_columns = [row[1] for row in cursor.fetchall()]
        if "auto_start_inference" not in cam_columns:
            cursor.execute("ALTER TABLE cameras ADD COLUMN auto_start_inference BOOLEAN DEFAULT 0")

        conn.commit()
        conn.close()
        print("[DB Migration] SQLite migrations checked/applied successfully.")
    except Exception as e:
        print(f"[DB Migration] Migration error: {e}")
