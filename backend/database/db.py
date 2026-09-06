import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from config import settings

# ─────────────────────────────────────────────────────────────────────────────
# PRODUCTION SAFETY GUARD
# If the test runner (IBVAP_TESTING=1) is active and the resolved DATABASE_URL
# still points to the production ibvap.db file, abort immediately with a clear
# error.  conftest.py sets IBVAP_TESTING=1 and overrides DATABASE_URL to
# sqlite:///:memory: before this module is imported, so this guard only fires
# if something has gone wrong with the test setup.
# ─────────────────────────────────────────────────────────────────────────────
def _assert_not_production_db(url: str) -> None:
    if not os.environ.get("IBVAP_TESTING"):
        return  # not running under pytest — skip check
    _prod_path = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ibvap.db")
    )
    if "sqlite" in url and ":memory:" not in url:
        try:
            db_path = url.split("sqlite:///", 1)[1]
            if not os.path.isabs(db_path):
                db_path = os.path.normpath(
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", db_path)
                )
            if os.path.normpath(db_path) == _prod_path:
                raise RuntimeError(
                    "SAFETY ERROR: Tests cannot use the production database. "
                    f"Attempted connection to: {db_path}. "
                    "Set DATABASE_URL=sqlite:///:memory: or use conftest.py isolation."
                )
        except RuntimeError:
            raise
        except Exception:
            pass  # If we can't parse the path, don't block


_assert_not_production_db(settings.DATABASE_URL)

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

        # Create registered_people table if it does not exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS registered_people (
                id TEXT PRIMARY KEY,
                person_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                identity_code TEXT UNIQUE,
                face_embedding TEXT NOT NULL,
                image_path TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_registered_people_person_id ON registered_people (person_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_registered_people_identity_code ON registered_people (identity_code)")

        # Create face_references table if it does not exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS face_references (
                id TEXT PRIMARY KEY,
                person_id TEXT NOT NULL,
                face_embedding TEXT NOT NULL,
                image_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (person_id) REFERENCES registered_people (person_id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_face_references_person_id ON face_references (person_id)")

        # Migrate legacy registered_people embeddings to face_references table if missing
        import uuid
        cursor.execute("SELECT person_id, face_embedding, image_path, created_at FROM registered_people")
        existing_people = cursor.fetchall()
        for p_id, emb, img_p, c_at in existing_people:
            if emb:
                cursor.execute("SELECT COUNT(*) FROM face_references WHERE person_id = ?", (p_id,))
                ref_count = cursor.fetchone()[0]
                if ref_count == 0:
                    ref_id = f"ref_{str(uuid.uuid4())[:8]}"
                    cursor.execute(
                        "INSERT INTO face_references (id, person_id, face_embedding, image_path, created_at) VALUES (?, ?, ?, ?, ?)",
                        (ref_id, p_id, emb, img_p, c_at or "")
                    )

        # Run column checks and add face recognition columns dynamically
        cursor.execute("PRAGMA table_info(detections)")
        det_columns = [row[1] for row in cursor.fetchall()]
        if "face" not in det_columns:
            cursor.execute("ALTER TABLE detections ADD COLUMN face TEXT")

        cursor.execute("PRAGMA table_info(tracks)")
        trk_columns = [row[1] for row in cursor.fetchall()]
        if "face" not in trk_columns:
            cursor.execute("ALTER TABLE tracks ADD COLUMN face TEXT")

        cursor.execute("PRAGMA table_info(incidents)")
        inc_columns = [row[1] for row in cursor.fetchall()]
        if "person_name" not in inc_columns:
            cursor.execute("ALTER TABLE incidents ADD COLUMN person_name TEXT DEFAULT 'UNKNOWN'")
        if "face_recognized" not in inc_columns:
            cursor.execute("ALTER TABLE incidents ADD COLUMN face_recognized BOOLEAN DEFAULT 0")
        if "face_confidence" not in inc_columns:
            cursor.execute("ALTER TABLE incidents ADD COLUMN face_confidence FLOAT DEFAULT 0.0")
        if "source_video_timestamp_sec" not in inc_columns:
            cursor.execute("ALTER TABLE incidents ADD COLUMN source_video_timestamp_sec FLOAT DEFAULT NULL")

        # Create suspicious_activities table if it does not exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS suspicious_activities (
                id TEXT PRIMARY KEY,
                activity_id TEXT UNIQUE NOT NULL,
                camera_id TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                track_label TEXT NOT NULL,
                activity_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'MEDIUM',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                duration_sec FLOAT DEFAULT 0.0,
                zone_name TEXT,
                description TEXT,
                incident_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_suspicious_activities_activity_id ON suspicious_activities (activity_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_suspicious_activities_camera_id ON suspicious_activities (camera_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_suspicious_activities_track_id ON suspicious_activities (track_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_suspicious_activities_activity_type ON suspicious_activities (activity_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_suspicious_activities_incident_id ON suspicious_activities (incident_id)")

        # Create night_movements table if it does not exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS night_movements (
                id TEXT PRIMARY KEY,
                movement_id TEXT UNIQUE NOT NULL,
                camera_id TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                track_label TEXT NOT NULL,
                avg_luma FLOAT NOT NULL,
                dark_pixel_ratio FLOAT NOT NULL,
                displacement FLOAT NOT NULL,
                path_length FLOAT NOT NULL,
                samples_count INTEGER NOT NULL DEFAULT 5,
                incident_id TEXT,
                detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_night_movements_movement_id ON night_movements (movement_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_night_movements_camera_id ON night_movements (camera_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_night_movements_track_id ON night_movements (track_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_night_movements_incident_id ON night_movements (incident_id)")

        # Create security_events table if it does not exist (Unified Intelligence)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS security_events (
                id TEXT PRIMARY KEY,
                event_id TEXT UNIQUE NOT NULL,
                camera_id TEXT NOT NULL,
                camera_name TEXT DEFAULT 'Camera',
                subject_type TEXT NOT NULL DEFAULT 'human',
                track_id INTEGER NOT NULL,
                track_label TEXT NOT NULL,
                threat_level TEXT NOT NULL DEFAULT 'low',
                threat_score INTEGER NOT NULL DEFAULT 20,
                threat_reason TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                contributing_signals TEXT DEFAULT '[]',
                related_incident_ids TEXT DEFAULT '[]',
                related_evidence_ids TEXT DEFAULT '[]',
                snapshot_url TEXT DEFAULT '',
                face_info TEXT,
                vehicle_info TEXT,
                first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_event_id ON security_events (event_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_camera_id ON security_events (camera_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_track_id ON security_events (track_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_threat_level ON security_events (threat_level)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_status ON security_events (status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_security_events_created_at ON security_events (created_at)")

        # Create c2_deliveries table if it does not exist (Command & Control Integration)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS c2_deliveries (
                id TEXT PRIMARY KEY,
                security_event_id TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'UNIFIED_SECURITY_EVENT',
                status TEXT NOT NULL DEFAULT 'PENDING',
                attempt_count INTEGER NOT NULL DEFAULT 1,
                last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                acknowledged_at DATETIME,
                response_status INTEGER,
                error_message TEXT,
                payload TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_c2_deliveries_security_event_id ON c2_deliveries (security_event_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_c2_deliveries_status ON c2_deliveries (status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_c2_deliveries_created_at ON c2_deliveries (created_at)")

        conn.commit()
        conn.close()
        print("[DB Migration] SQLite migrations checked/applied successfully.")

    except Exception as e:
        print(f"[DB Migration] Migration error: {e}")

