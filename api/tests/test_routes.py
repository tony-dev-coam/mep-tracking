from pathlib import Path

import pytest


def create_project(client, name="Tower A"):
    r = client.post("/api/projects", json={"name": name})
    assert r.status_code == 201
    return r.json()


def upload(client, project_id, path, filename=None):
    with open(path, "rb") as fh:
        return client.post(f"/api/projects/{project_id}/models",
                           files={"file": (filename or Path(path).name, fh, "application/octet-stream")})


@pytest.fixture
def processed(client, ifc):
    """A project with the clean fixture uploaded and processed."""
    project = create_project(client)
    model = upload(client, project["id"], ifc["clean"]).json()
    return client.get(f"/api/models/{model['id']}").json()


# --- projects -------------------------------------------------------------------

def test_create_and_list_projects(client):
    created = create_project(client)
    assert created["name"] == "Tower A"
    assert [p["id"] for p in client.get("/api/projects").json()] == [created["id"]]


def test_duplicate_project_name_conflicts(client):
    create_project(client)
    r = client.post("/api/projects", json={"name": "Tower A"})
    assert r.status_code == 409
    assert r.json() == {"error": "Project name already exists"}


def test_blank_project_name_rejected(client):
    assert client.post("/api/projects", json={"name": "  "}).status_code == 422


# --- upload + status --------------------------------------------------------------

def test_upload_returns_202_with_location_and_processes(client, ifc, tmp_path):
    project = create_project(client)
    r = upload(client, project["id"], ifc["clean"])
    assert r.status_code == 202
    body = r.json()
    assert r.headers["location"] == f"/api/models/{body['id']}"
    assert (body["status"], body["version"], body["filename"]) == ("processing", 1, "clean.ifc")
    assert (tmp_path / f"{body['id']}.ifc").exists()
    model = client.get(r.headers["location"]).json()
    assert model["status"] == "processed"
    assert model["ifc_schema"] == "IFC4"
    assert model["element_count"] == 8
    assert model["validation"]["summary"]["error"] == 0


def test_versions_increment_per_project(client, ifc):
    a, b = create_project(client, "A"), create_project(client, "B")
    assert upload(client, a["id"], ifc["clean"]).json()["version"] == 1
    assert upload(client, a["id"], ifc["clean"]).json()["version"] == 2
    assert upload(client, b["id"], ifc["clean"]).json()["version"] == 1
    versions = [m["version"] for m in client.get(f"/api/projects/{a['id']}/models").json()]
    assert versions == [2, 1]


def test_second_version_leaves_first_untouched(client, ifc):
    project = create_project(client)
    v1 = upload(client, project["id"], ifc["clean"]).json()["id"]
    upload(client, project["id"], ifc["defects"])
    assert len(client.get(f"/api/models/{v1}/global-ids").json()) == 14


def test_non_ifc_extension_rejected(client, ifc):
    project = create_project(client)
    r = upload(client, project["id"], ifc["clean"], filename="model.txt")
    assert r.status_code == 400
    assert r.json() == {"error": "Only .ifc files are accepted"}


def test_upload_over_limit_rejected(client, ifc, monkeypatch, tmp_path):
    monkeypatch.setenv("MAX_UPLOAD_MB", "0.001")  # ~1 KB
    project = create_project(client)
    r = upload(client, project["id"], ifc["clean"])
    assert r.status_code == 413
    assert list(tmp_path.glob("*.ifc")) == []
    assert client.get(f"/api/projects/{project['id']}/models").json() == []


def test_upload_to_unknown_project_404(client, ifc):
    r = upload(client, "00000000-0000-0000-0000-000000000000", ifc["clean"])
    assert r.status_code == 404


def test_corrupt_upload_fails_and_api_stays_healthy(client, ifc):
    project = create_project(client)
    model_id = upload(client, project["id"], ifc["corrupt"]).json()["id"]
    model = client.get(f"/api/models/{model_id}").json()
    assert model["status"] == "failed"
    assert "Cannot read IFC file" in model["error"]
    assert client.get("/health").status_code == 200


def test_unknown_model_404(client):
    assert client.get("/api/models/00000000-0000-0000-0000-000000000000").status_code == 404


def test_startup_marks_stale_processing_models_failed(client, db):
    from fastapi.testclient import TestClient

    from app.main import app

    project_id = db.execute("INSERT INTO projects (name) VALUES ('S') RETURNING id").fetchone()[0]
    model_id = db.execute("INSERT INTO ifc_models (project_id, version, filename) "
                          "VALUES (%s, 1, 'x.ifc') RETURNING id", (project_id,)).fetchone()[0]
    with TestClient(app) as restarted:
        model = restarted.get(f"/api/models/{model_id}").json()
    assert (model["status"], model["error"]) == ("failed", "interrupted")


# --- file -------------------------------------------------------------------------

def test_file_served_when_processed(client, processed, ifc):
    r = client.get(f"/api/models/{processed['id']}/file")
    assert r.status_code == 200
    assert r.content == Path(ifc["clean"]).read_bytes()


def test_file_conflicts_unless_processed(client, ifc):
    project = create_project(client)
    model_id = upload(client, project["id"], ifc["corrupt"]).json()["id"]
    assert client.get(f"/api/models/{model_id}/file").status_code == 409


# --- elements ---------------------------------------------------------------------

def elements(client, model_id, **params):
    return client.get(f"/api/models/{model_id}/elements", params=params).json()


def test_equipment_filter(client, processed):
    names = sorted(e["name"] for e in elements(client, processed["id"], equipment="true"))
    assert names == ["AHU 01", "Pump 01", "Skid Pump", "Valve 01"]


def test_type_and_storey_and_parent_filters(client, processed):
    by_name = {e["name"]: e for e in elements(client, processed["id"])}
    level2 = by_name["Level 02"]["global_id"]
    room = by_name["Mechanical Room"]["global_id"]
    assert [e["name"] for e in elements(client, processed["id"], type="IfcValve")] == ["Valve 01"]
    assert {e["name"] for e in elements(client, processed["id"], storey=level2)} == {
        "Level 02", "Valve 01", "Pump Skid", "Skid Pump"}
    assert [e["name"] for e in elements(client, processed["id"], parent=room)] == ["AHU 01"]


def test_list_omits_properties_and_paginates(client, processed):
    page = elements(client, processed["id"], limit=5, offset=0)
    rest = elements(client, processed["id"], limit=1000, offset=5)
    assert len(page) == 5 and len(rest) == 9
    assert "properties" not in page[0]
    assert {e["global_id"] for e in page}.isdisjoint(e["global_id"] for e in rest)


def test_limit_capped_at_1000(client, processed):
    r = client.get(f"/api/models/{processed['id']}/elements", params={"limit": 1001})
    assert r.status_code == 422


def test_single_element_has_properties_and_materials(client, processed):
    wall = next(e for e in elements(client, processed["id"]) if e["name"] == "Wall 01")
    full = client.get(f"/api/models/{processed['id']}/elements/{wall['global_id']}").json()
    assert full["materials"] == ["Concrete"]
    assert isinstance(full["properties"], dict)


def test_unknown_element_404(client, processed):
    r = client.get(f"/api/models/{processed['id']}/elements/nope")
    assert r.status_code == 404
    assert r.json() == {"error": "Element not found"}


def test_global_ids_uncapped_with_same_filters(client, processed):
    ids = client.get(f"/api/models/{processed['id']}/global-ids", params={"equipment": "true"}).json()
    assert sorted(ids) == sorted(e["global_id"] for e in elements(client, processed["id"], equipment="true"))


# --- spatial tree -----------------------------------------------------------------

def test_spatial_tree_nests_with_element_counts(client, processed):
    tree = client.get(f"/api/models/{processed['id']}/spatial-tree").json()
    assert tree["ifc_type"] == "IfcProject"
    building = tree["children"][0]["children"][0]
    levels = {n["name"]: n for n in building["children"]}
    assert set(levels) == {"Level 01", "Level 02"}
    assert levels["Level 01"]["element_count"] == 4  # pump, duct, fitting, wall (AHU is in the room)
    assert levels["Level 01"]["children"][0]["name"] == "Mechanical Room"
    assert levels["Level 01"]["children"][0]["element_count"] == 1


def test_spatial_tree_404_when_model_has_no_elements(client, ifc):
    project = create_project(client)
    model_id = upload(client, project["id"], ifc["corrupt"]).json()["id"]
    r = client.get(f"/api/models/{model_id}/spatial-tree")
    assert r.status_code == 404
    assert r.json() == {"error": "Model has no spatial tree"}
