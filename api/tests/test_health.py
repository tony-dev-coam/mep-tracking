def test_health_reports_ok_when_db_reachable(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_schema_has_core_tables(db):
    rows = db.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    ).fetchall()
    assert {"projects", "ifc_models", "ifc_elements"} <= {r[0] for r in rows}
