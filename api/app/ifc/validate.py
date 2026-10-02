"""Model quality report. Pure: works on the model and its extracted rows."""

from collections import Counter

import ifcopenshell

from app.ifc.extract import schema_of

MAX_IDS = 100


def check(code, ok, message, count=0, global_ids=(), fail="WARNING"):
    return {"code": code, "severity": "PASS" if ok else fail, "message": message,
            "count": count, "global_ids": list(global_ids)[:MAX_IDS]}


def offenders(code, message, global_ids, fail="WARNING"):
    return check(code, not global_ids, message, len(global_ids), global_ids, fail)


def has_manufacturer(row) -> bool:
    return bool(row["properties"].get("Pset_ManufacturerTypeInformation", {}).get("Manufacturer"))


def validate(model: ifcopenshell.file, rows: list[dict]) -> dict:
    equipment = [r for r in rows if r["is_equipment"]]
    projects = len(model.by_type("IfcProject"))
    buildings = len(model.by_type("IfcBuilding"))
    storeys = len(model.by_type("IfcBuildingStorey"))
    elements = sum(not r["is_spatial"] for r in rows)

    tags = Counter(r["tag"] for r in equipment if r["tag"])
    gids = Counter(r["global_id"] for r in rows)

    checks = [
        check("schema", True, schema_of(model), 1),
        check("project", projects == 1, f"{projects} Project", projects, fail="ERROR"),
        check("building", buildings >= 1, f"{buildings} Building", buildings, fail="ERROR"),
        check("storeys", storeys >= 1, f"{storeys} Storeys", storeys),
        check("elements", True, f"{elements} Elements", elements),
        check("no_equipment", bool(equipment), f"{len(equipment)} Equipment", len(equipment)),
        offenders("missing_properties", "Equipment without properties",
                  [r["global_id"] for r in equipment if not r["properties"]]),
        offenders("missing_manufacturer", "Equipment without manufacturer",
                  [r["global_id"] for r in equipment if not has_manufacturer(r)]),
        offenders("missing_container", "Equipment without spatial container",
                  [r["global_id"] for r in equipment if not r["parent_global_id"]]),
        offenders("duplicate_tag", "Duplicate equipment IDs",
                  [r["global_id"] for r in equipment if tags[r["tag"]] > 1], fail="ERROR"),
        offenders("duplicate_global_id", "Duplicate GlobalIds",
                  [g for g, n in gids.items() if n > 1], fail="ERROR"),
    ]
    summary = Counter(c["severity"].lower() for c in checks)
    return {"summary": {k: summary[k] for k in ("pass", "warning", "error")}, "checks": checks}
