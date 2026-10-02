import uuid

from fastapi import APIRouter, HTTPException, Query

from app import db

router = APIRouter(prefix="/api/models/{model_id}")

SUMMARY_COLUMNS = ("global_id, express_id, ifc_type, name, object_type, tag, parent_global_id, "
                   "storey_global_id, is_spatial, is_equipment, has_geometry")


def filters(model_id, equipment, storey, parent, ifc_type):
    """WHERE clause + params shared by /elements and /global-ids."""
    where, params = ["model_id = %s"], [model_id]
    if equipment is not None:
        where.append("is_equipment = %s")
        params.append(equipment)
    for column, value in (("storey_global_id", storey), ("parent_global_id", parent),
                          ("ifc_type", ifc_type)):
        if value is not None:
            where.append(f"{column} = %s")
            params.append(value)
    return " AND ".join(where), params


@router.get("/elements")
def list_elements(model_id: uuid.UUID, equipment: bool | None = None, storey: str | None = None,
                  parent: str | None = None, type: str | None = None,
                  limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    where, params = filters(model_id, equipment, storey, parent, type)
    return db.fetch_all(
        f"SELECT {SUMMARY_COLUMNS} FROM ifc_elements WHERE {where} ORDER BY id LIMIT %s OFFSET %s",
        (*params, limit, offset),
    )


@router.get("/global-ids")
def list_global_ids(model_id: uuid.UUID, equipment: bool | None = None, storey: str | None = None,
                    parent: str | None = None, type: str | None = None):
    where, params = filters(model_id, equipment, storey, parent, type)
    return [r["global_id"] for r in
            db.fetch_all(f"SELECT global_id FROM ifc_elements WHERE {where} ORDER BY id", params)]


@router.get("/elements/{global_id}")
def read_element(model_id: uuid.UUID, global_id: str):
    row = db.fetch_one(
        f"SELECT {SUMMARY_COLUMNS}, properties, materials FROM ifc_elements "
        "WHERE model_id=%s AND global_id=%s", (model_id, global_id),
    )
    if not row:
        raise HTTPException(404, "Element not found")
    return row


@router.get("/spatial-tree")
def spatial_tree(model_id: uuid.UUID):
    nodes = db.fetch_all(
        "SELECT s.global_id, s.name, s.ifc_type, s.parent_global_id, "
        "  (SELECT count(*) FROM ifc_elements e WHERE e.model_id = s.model_id "
        "     AND e.parent_global_id = s.global_id AND NOT e.is_spatial) AS element_count "
        "FROM ifc_elements s WHERE s.model_id=%s AND s.is_spatial ORDER BY s.id", (model_id,),
    )
    by_id = {n["global_id"]: {**n, "children": []} for n in nodes}
    root = None
    for node in by_id.values():
        parent = by_id.get(node.pop("parent_global_id"))
        if parent:
            parent["children"].append(node)
        elif node["ifc_type"] == "IfcProject":
            root = node
    if root is None:
        raise HTTPException(404, "Model has no spatial tree")
    return root
