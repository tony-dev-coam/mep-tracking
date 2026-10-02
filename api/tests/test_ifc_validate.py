import pytest

from app.ifc import extract, open_model, validate


def report_for(path):
    model = open_model(path)
    report = validate(model, extract(model))
    return report, {c["code"]: c for c in report["checks"]}


def test_clean_model_passes_every_check(ifc):
    report, checks = report_for(ifc["clean"])
    assert {c["severity"] for c in checks.values()} == {"PASS"}
    assert report["summary"] == {"pass": len(checks), "warning": 0, "error": 0}
    assert checks["schema"]["message"] == "IFC4"
    assert checks["storeys"]["count"] == 2


def test_defect_model_reports_exact_findings(ifc):
    model = open_model(ifc["defects"])
    rows = extract(model)
    gid = {r["name"]: r["global_id"] for r in rows}
    checks = {c["code"]: c for c in validate(model, rows)["checks"]}

    def finding(code):
        c = checks[code]
        return c["severity"], c["count"], sorted(c["global_ids"])

    assert finding("missing_manufacturer") == (
        "WARNING", 2, sorted([gid["Valve no psets"], gid["Terminal uncontained"]]))
    assert finding("missing_properties") == ("WARNING", 1, [gid["Valve no psets"]])
    assert finding("missing_container") == ("WARNING", 1, [gid["Terminal uncontained"]])
    assert finding("duplicate_tag") == ("ERROR", 2, sorted([gid["Pump A"], gid["Pump B"]]))
    assert checks["duplicate_global_id"]["severity"] == "PASS"


def test_missing_building_is_error(ifc):
    _, checks = report_for(ifc["no_building"])
    assert checks["building"]["severity"] == "ERROR"


def test_no_storeys_and_no_equipment_are_warnings(ifc):
    _, checks = report_for(ifc["no_equipment_no_storeys"])
    assert checks["storeys"]["severity"] == "WARNING"
    assert checks["no_equipment"]["severity"] == "WARNING"


def test_element_count_excludes_spatial_elements(ifc):
    model = open_model(ifc["clean"])
    rows = extract(model)
    checks = {c["code"]: c for c in validate(model, rows)["checks"]}
    assert checks["elements"]["count"] == sum(not r["is_spatial"] for r in rows) == 8


def test_duplicate_global_id_is_error(ifc):
    model = open_model(ifc["clean"])
    rows = extract(model)
    rows.append(dict(rows[-1]))
    checks = {c["code"]: c for c in validate(model, rows)["checks"]}
    assert checks["duplicate_global_id"]["severity"] == "ERROR"
    assert checks["duplicate_global_id"]["global_ids"] == [rows[-1]["global_id"]]


def test_global_ids_capped_at_100_but_count_is_exact(ifc):
    model = open_model(ifc["clean"])
    rows = extract(model)
    pump = next(r for r in rows if r["name"] == "Pump 01")
    rows += [dict(pump, global_id=f"X{i}", properties={}) for i in range(150)]
    checks = {c["code"]: c for c in validate(model, rows)["checks"]}
    assert checks["missing_properties"]["count"] == 150
    assert len(checks["missing_properties"]["global_ids"]) == 100


@pytest.mark.parametrize("code", ["schema", "project", "building", "storeys", "elements",
                                  "no_equipment", "missing_properties", "missing_manufacturer",
                                  "missing_container", "duplicate_tag", "duplicate_global_id"])
def test_report_contains_every_check(ifc, code):
    _, checks = report_for(ifc["clean"])
    assert code in checks
