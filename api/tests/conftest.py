import os

import psycopg
import pytest

ADMIN_URL = os.environ["DATABASE_URL"]
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + "/mep_test"
os.environ["DATABASE_URL"] = TEST_URL  # before app import: app reads it at startup


@pytest.fixture(scope="session", autouse=True)
def test_db():
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("DROP DATABASE IF EXISTS mep_test WITH (FORCE)")
        conn.execute("CREATE DATABASE mep_test")
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), "head")
    yield


@pytest.fixture
def db():
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        conn.execute("TRUNCATE projects CASCADE")
        yield conn


@pytest.fixture
def client(db, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    from app.main import app

    class InlineExecutor:  # run jobs synchronously so tests see the final status
        def submit(self, fn, *args):
            fn(*args)

    with TestClient(app) as c:
        app.state.executor = InlineExecutor()
        yield c


@pytest.fixture(scope="session")
def ifc(tmp_path_factory):
    """Path to each synthetic IFC by name, built once per session."""
    from tests.fixtures import make_fixtures as m

    out = tmp_path_factory.mktemp("ifc")
    names = ["clean", "defects", "no_building", "no_equipment_no_storeys",
             "ifc2x3", "corrupt", "unsupported_schema"]
    return {n: getattr(m, f"build_{n}")(out / f"{n}.ifc") for n in names}
