"""Black-box tests against the running compose stack (real ProcessPoolExecutor, real HTTP).

Run: docker compose up -d && docker compose run --rm -e STACK_URL=http://api:8000 api pytest tests/integration
Skipped when STACK_URL is unset, so the unit run stays self-contained.
"""

import os
import time
import uuid
from pathlib import Path

import httpx2 as httpx
import pytest

STACK_URL = os.environ.get("STACK_URL")
pytestmark = pytest.mark.skipif(not STACK_URL, reason="STACK_URL not set (needs running compose stack)")

TIMEOUT_S = 60


@pytest.fixture
def api():
    with httpx.Client(base_url=STACK_URL, timeout=30) as client:
        yield client


@pytest.fixture
def project(api):
    r = api.post("/api/projects", json={"name": f"it-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201
    return r.json()["id"]


def upload(api, project_id, path) -> dict:
    with open(path, "rb") as fh:
        r = api.post(f"/api/projects/{project_id}/models", files={"file": (Path(path).name, fh)})
    assert r.status_code == 202, r.text
    return r.json()


def wait_settled(api, model_id) -> dict:
    deadline = time.monotonic() + TIMEOUT_S
    while time.monotonic() < deadline:
        model = api.get(f"/api/models/{model_id}").json()
        if model["status"] != "processing":
            return model
        time.sleep(0.5)
    pytest.fail(f"model {model_id} still processing after {TIMEOUT_S}s")


def checks(model) -> dict:
    return {c["code"]: c for c in model["validation"]["checks"]}


def test_defect_fixture_processes_with_expected_findings(api, project, ifc):
    model = wait_settled(api, upload(api, project, ifc["defects"])["id"])
    assert model["status"] == "processed"
    c = checks(model)
    assert (c["missing_manufacturer"]["severity"], c["missing_manufacturer"]["count"]) == ("WARNING", 2)
    assert (c["missing_container"]["severity"], c["missing_container"]["count"]) == ("WARNING", 1)
    assert (c["duplicate_tag"]["severity"], c["duplicate_tag"]["count"]) == ("ERROR", 2)


def test_corrupt_upload_fails_and_api_stays_healthy(api, project, ifc):
    model = wait_settled(api, upload(api, project, ifc["corrupt"])["id"])
    assert model["status"] == "failed"
    assert "Cannot read IFC file" in model["error"]
    assert api.get("/health").json() == {"status": "ok"}


def test_second_version_leaves_first_untouched(api, project, ifc):
    v1 = wait_settled(api, upload(api, project, ifc["clean"])["id"])
    before = api.get(f"/api/models/{v1['id']}/global-ids").json()
    v2 = wait_settled(api, upload(api, project, ifc["defects"])["id"])
    assert (v1["version"], v2["version"]) == (1, 2)
    assert api.get(f"/api/models/{v1['id']}/global-ids").json() == before


def test_concurrent_uploads_queue_and_all_finish(api, project, ifc):
    ids = [upload(api, project, ifc["clean"])["id"] for _ in range(3)]
    assert [wait_settled(api, i)["status"] for i in ids] == ["processed"] * 3


def test_demo_model_end_to_end(api, project, demo_path):
    model = wait_settled(api, upload(api, project, demo_path)["id"])
    assert (model["status"], model["ifc_schema"], model["element_count"]) == ("processed", "IFC4", 47)
    tree = api.get(f"/api/models/{model['id']}/spatial-tree").json()
    building = tree["children"][0]["children"][0]
    assert [n["name"] for n in building["children"]] == ["Level 01", "Level 02", "Level 03"]
    assert len(api.get(f"/api/models/{model['id']}/global-ids", params={"equipment": "true"}).json()) == 29
    served = api.get(f"/api/models/{model['id']}/file")
    assert served.content == Path(demo_path).read_bytes()


@pytest.fixture
def demo_path():
    # The api container mounts ./api at /srv; samples/ lives beside it, so the compose run mounts it too.
    path = Path(os.environ.get("DEMO_IFC", "/samples/demo-plant.ifc"))
    if not path.exists():
        pytest.skip(f"demo model not mounted at {path}")
    return path
