import shutil

import ifcopenshell
import pytest

from app.processing import process_model


@pytest.fixture
def upload(db, tmp_path, monkeypatch):
    """Create a project + processing model whose file is a copy of the given fixture."""
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    project_id = db.execute("INSERT INTO projects (name) VALUES ('P') RETURNING id").fetchone()[0]

    def make(src, version=1):
        model_id = db.execute(
            "INSERT INTO ifc_models (project_id, version, filename) VALUES (%s, %s, 'x.ifc') RETURNING id",
            (project_id, version),
        ).fetchone()[0]
        shutil.copy(src, tmp_path / f"{model_id}.ifc")
        return model_id

    return make


def model_row(db, model_id):
    return db.execute(
        "SELECT status, ifc_schema, element_count, validation, error, processed_at FROM ifc_models WHERE id=%s",
        (model_id,),
    ).fetchone()


def element_count(db, model_id):
    return db.execute("SELECT count(*) FROM ifc_elements WHERE model_id=%s", (model_id,)).fetchone()[0]


def test_success_marks_processed_and_stores_elements(db, upload, ifc):
    model_id = upload(ifc["clean"])
    process_model(model_id)
    status, schema, count, validation, error, processed_at = model_row(db, model_id)
    assert (status, schema, count, error) == ("processed", "IFC4", 8, None)
    assert validation["summary"]["error"] == 0
    assert processed_at is not None
    assert element_count(db, model_id) == 14  # 8 elements + project, site, building, 2 storeys, space


def test_properties_queryable_as_jsonb(db, upload, ifc):
    model_id = upload(ifc["clean"])
    process_model(model_id)
    makers = db.execute(
        "SELECT properties->'Pset_ManufacturerTypeInformation'->>'Manufacturer' FROM ifc_elements "
        "WHERE model_id=%s AND is_equipment ORDER BY 1", (model_id,)
    ).fetchall()
    assert [m[0] for m in makers] == ["Danfoss", "Grundfos", "Trane", "Wilo"]


def test_reprocessing_replaces_rows(db, upload, ifc):
    model_id = upload(ifc["clean"])
    process_model(model_id)
    process_model(model_id)
    assert element_count(db, model_id) == 14


def test_unreadable_file_marks_failed_with_error(db, upload, ifc):
    model_id = upload(ifc["corrupt"])
    process_model(model_id)
    status, _, _, _, error, _ = model_row(db, model_id)
    assert status == "failed"
    assert "Cannot read IFC file" in error
    assert element_count(db, model_id) == 0


def test_failure_after_success_leaves_no_rows(db, upload, ifc, tmp_path):
    model_id = upload(ifc["clean"])
    process_model(model_id)
    shutil.copy(ifc["corrupt"], tmp_path / f"{model_id}.ifc")
    process_model(model_id)
    assert model_row(db, model_id)[0] == "failed"
    assert element_count(db, model_id) == 0


def test_unexpected_exception_marks_failed(db, upload, ifc, monkeypatch):
    model_id = upload(ifc["clean"])
    monkeypatch.setattr("app.processing.validate", lambda *a: 1 / 0)
    process_model(model_id)
    status, _, _, _, error, _ = model_row(db, model_id)
    assert status == "failed"
    assert "division by zero" in error


def test_duplicate_global_id_keeps_first_and_reports_error(db, upload, ifc, tmp_path):
    model = ifcopenshell.open(ifc["clean"])
    pump, valve = model.by_type("IfcPump")[0], model.by_type("IfcValve")[0]
    valve.GlobalId = pump.GlobalId
    dup = tmp_path / "dup.ifc"
    model.write(str(dup))
    model_id = upload(dup)
    process_model(model_id)
    status, _, _, validation, _, _ = model_row(db, model_id)
    assert status == "processed"
    checks = {c["code"]: c for c in validation["checks"]}
    assert checks["duplicate_global_id"]["severity"] == "ERROR"
    assert element_count(db, model_id) == 13
