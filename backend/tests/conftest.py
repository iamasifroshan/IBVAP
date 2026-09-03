"""
IBVAP Test Database Isolation — conftest.py
============================================
This file is auto-loaded by pytest before ANY test module is imported.

PRODUCTION SAFETY GUARANTEE:
  - All tests run against an ephemeral in-memory SQLite database.
  - The production database (ibvap.db) is NEVER touched during tests.
  - Any attempt to connect to the production path raises an immediate
    RuntimeError: "SAFETY ERROR: Tests cannot use the production database."

HOW IT WORKS:
  1. Sets DATABASE_URL env var to "sqlite:///:memory:" before any import.
  2. Patches database.db (engine, SessionLocal, Base, get_db) to use
     the test engine, so all direct imports of those symbols in test files
     also get the isolated versions.
  3. Overrides FastAPI's app.dependency_overrides[get_db] so all HTTP
     test client calls (TestClient) also use the isolated DB.
  4. Creates all tables (metadata.create_all) and runs idempotent
     migrations on the in-memory DB at session start.
  5. Each test gets a fresh, rolled-back database session via the
     test_db fixture (optional — test classes using self.db directly
     still see the same session-scoped test engine).
"""

import os
import sys
import pytest

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Set DATABASE_URL env var BEFORE any backend module is imported.
# config.py reads DATABASE_URL at class-definition time, so this must happen
# before config is imported anywhere.
# ─────────────────────────────────────────────────────────────────────────────
_PRODUCTION_DB_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "ibvap.db"
))
_TEST_DATABASE_URL = "sqlite:///:memory:"

os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
os.environ["IBVAP_TESTING"] = "1"  # flag read by db.py safety guard

# Add backend to sys.path so imports work from tests/
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Import backend modules (now they will pick up the env var above).
# ─────────────────────────────────────────────────────────────────────────────
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import database module — at this point config.settings.DATABASE_URL is
# already "sqlite:///:memory:" because we set the env var above.
import database.db as _db_module
from database.db import Base, get_db as _original_get_db  # capture BEFORE we replace

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Build the isolated test engine and session factory.
#
# CRITICAL: Use StaticPool so that ALL connections to sqlite:///:memory:
# share the SAME in-memory database.  Without StaticPool each new connection
# (i.e. each new SessionLocal() call) would open a fresh empty database and
# see "no such table" errors.
# ─────────────────────────────────────────────────────────────────────────────
_test_engine = create_engine(
    _TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

_TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Patch database.db module globals so that all test code that does:
#   from database.db import SessionLocal, engine, Base, get_db
# gets the isolated versions.
# ─────────────────────────────────────────────────────────────────────────────
_db_module.engine = _test_engine
_db_module.SessionLocal = _TestSessionLocal
# Base is already shared (same metadata), bind it to the test engine.
# We do NOT replace Base itself — it carries the model metadata.


def _test_get_db():
    """Isolated get_db generator for FastAPI dependency injection during tests."""
    db = _TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


_db_module.get_db = _test_get_db


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Override FastAPI dependency injection.
# This ensures TestClient HTTP calls also use the test DB.
# ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session", autouse=True)
def _setup_test_database():
    """
    Session-scoped fixture: runs once for the entire test suite.
    1. Creates all tables on the in-memory engine.
    2. Runs idempotent SQLite migrations on the in-memory engine.
    3. Overrides FastAPI's get_db dependency with the test version.
    4. Tears down (drops all tables) after the session ends.
    """
    # Create all ORM-mapped tables
    Base.metadata.create_all(bind=_test_engine)

    # Run the idempotent migration function against the test engine
    _run_test_migrations()

    # Override FastAPI's get_db — use _original_get_db captured before we
    # patched the module global, so the key exactly matches the callable
    # FastAPI stored during router registration.
    from main import app
    app.dependency_overrides[_original_get_db] = _test_get_db

    yield  # run all tests

    # Teardown
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_test_engine)


def _run_test_migrations():
    """
    Runs all idempotent column/table migrations against the in-memory test
    engine using a raw SQLite connection from the test engine.
    Mirrors run_migrations() in database/db.py but targets the test DB.
    """
    raw_conn = _test_engine.raw_connection()
    cursor = raw_conn.cursor()

    try:
        # zones table columns
        cursor.execute("PRAGMA table_info(zones)")
        columns = [row[1] for row in cursor.fetchall()]
        for col, ddl in [
            ("human_detection", "BOOLEAN DEFAULT 1"),
            ("vehicle_detection", "BOOLEAN DEFAULT 0"),
            ("animal_detection", "BOOLEAN DEFAULT 0"),
        ]:
            if col not in columns:
                cursor.execute(f"ALTER TABLE zones ADD COLUMN {col} {ddl}")

        # cameras table columns
        cursor.execute("PRAGMA table_info(cameras)")
        cam_columns = [row[1] for row in cursor.fetchall()]
        if "auto_start_inference" not in cam_columns:
            cursor.execute(
                "ALTER TABLE cameras ADD COLUMN auto_start_inference BOOLEAN DEFAULT 0"
            )

        # registered_people table
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
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_registered_people_person_id "
            "ON registered_people (person_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_registered_people_identity_code "
            "ON registered_people (identity_code)"
        )

        # face_references table
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
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_face_references_person_id "
            "ON face_references (person_id)"
        )

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

        # detections.face column
        cursor.execute("PRAGMA table_info(detections)")
        det_columns = [row[1] for row in cursor.fetchall()]
        if "face" not in det_columns:
            cursor.execute("ALTER TABLE detections ADD COLUMN face TEXT")

        # tracks.face column
        cursor.execute("PRAGMA table_info(tracks)")
        trk_columns = [row[1] for row in cursor.fetchall()]
        if "face" not in trk_columns:
            cursor.execute("ALTER TABLE tracks ADD COLUMN face TEXT")

        # incidents face recognition columns
        cursor.execute("PRAGMA table_info(incidents)")
        inc_columns = [row[1] for row in cursor.fetchall()]
        for col, ddl in [
            ("person_name", "TEXT DEFAULT 'UNKNOWN'"),
            ("face_recognized", "BOOLEAN DEFAULT 0"),
            ("face_confidence", "FLOAT DEFAULT 0.0"),
        ]:
            if col not in inc_columns:
                cursor.execute(f"ALTER TABLE incidents ADD COLUMN {col} {ddl}")

        raw_conn.commit()
        print(
            "[TEST DB] In-memory test database created and migrations applied successfully."
        )
    except Exception as exc:
        print(f"[TEST DB] Migration warning (non-fatal): {exc}")
        raw_conn.rollback()
    finally:
        cursor.close()
        raw_conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Optional per-test db fixture (for pytest-style tests).
# unittest-style tests that use self.db = SessionLocal() will get the
# patched _TestSessionLocal (since we replaced the module global in STEP 4).
# ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture()
def test_db(_setup_test_database):
    """
    Per-test fixture: provides a test DB session and rolls back after the test.
    Use this in pytest-style tests:
        def test_something(test_db):
            test_db.add(...)
    """
    session = _TestSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
