"""Read an IFC file into flat element rows. Pure: no DB access."""

import ifcopenshell
import ifcopenshell.util.element as util

SUPPORTED_SCHEMAS = {"IFC2X3", "IFC4", "IFC4X3"}


class FatalIfcError(Exception):
    """The file cannot be processed at all (unreadable or unsupported schema)."""


def open_model(path: str) -> ifcopenshell.file:
    try:
        model = ifcopenshell.open(path)
    except Exception as e:  # ifcopenshell raises several unrelated types for bad input
        raise FatalIfcError(f"Cannot read IFC file: {e}") from e
    if schema_of(model) not in SUPPORTED_SCHEMAS:
        raise FatalIfcError(f"Unsupported IFC schema: {model.schema}")
    return model


def schema_of(model: ifcopenshell.file) -> str:
    return model.schema.upper().split("_")[0]  # IFC4X3_ADD2 -> IFC4X3


def is_equipment(el) -> bool:
    return el.is_a("IfcDistributionElement") and not (
        el.is_a("IfcFlowSegment") or el.is_a("IfcFlowFitting")
    )


def is_spatial(el) -> bool:
    return el.is_a("IfcProject") or el.is_a("IfcSpatialStructureElement")


def spatial_parent(el):
    """Nearest spatial element above `el`, walking up through element assemblies."""
    while el is not None:
        if container := util.get_container(el):
            return container
        el = util.get_aggregate(el)
        if el is not None and is_spatial(el):
            return el
    return None


def extract(model: ifcopenshell.file) -> list[dict]:
    elements = model.by_type("IfcProject") + model.by_type("IfcProduct")
    parent = {el.id(): spatial_parent(el) for el in elements}

    def storey_of(el):
        while el is not None and not el.is_a("IfcBuildingStorey"):
            el = parent.get(el.id())
        return el

    rows = []
    for el in elements:
        p, storey = parent[el.id()], storey_of(el)
        rows.append({
            "global_id": el.GlobalId,
            "express_id": el.id(),
            "ifc_type": el.is_a(),
            "name": el.Name,
            "object_type": getattr(el, "ObjectType", None),
            "tag": getattr(el, "Tag", None),
            "parent_global_id": p.GlobalId if p else None,
            "storey_global_id": storey.GlobalId if storey else None,
            "is_spatial": is_spatial(el),
            "is_equipment": is_equipment(el),
            "has_geometry": getattr(el, "Representation", None) is not None,
            "properties": psets_of(el),
            "materials": [m.Name for m in util.get_materials(el) if m.Name],
        })
    return rows


def psets_of(el) -> dict:
    """Psets and quantities, type values overridden by occurrence values, JSON-safe."""
    return {
        name: {k: json_safe(v) for k, v in props.items() if k != "id"}
        for name, props in util.get_psets(el).items()
    }


def json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return str(value)
