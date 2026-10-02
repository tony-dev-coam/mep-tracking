"""Deterministic synthetic IFC models for tests.

clean:   every validation check passes; covers spaces, type psets, an assembly,
         a material, and equipment without geometry.
defects: 2 missing_manufacturer, 1 missing_properties, 1 missing_container,
         duplicate_tag on 2 elements.
"""

import ifcopenshell
import numpy
import ifcopenshell.guid
import ifcopenshell.api as api
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.type
import ifcopenshell.api.unit


class Builder:
    def __init__(self, schema: str = "IFC4"):
        self.f = ifcopenshell.file(schema=schema)
        self.project = self.add("IfcProject", "Project")
        api.unit.assign_unit(self.f)
        model_ctx = api.context.add_context(self.f, context_type="Model")
        self.body = api.context.add_context(
            self.f, context_type="Model", context_identifier="Body",
            target_view="MODEL_VIEW", parent=model_ctx,
        )

    def add(self, ifc_class: str, name: str, **attrs):
        el = api.root.create_entity(self.f, ifc_class=ifc_class, name=name)
        for k, v in attrs.items():
            setattr(el, k, v)
        return el

    def aggregate(self, parent, *children):
        api.aggregate.assign_object(self.f, products=list(children), relating_object=parent)

    def contain(self, structure, *products):
        api.spatial.assign_container(self.f, products=list(products), relating_structure=structure)

    def geometry(self, el, size=(1.0, 0.2, 1.0), at=(0.0, 0.0, 0.0)):
        """Box of size (x, y, z) metres with its corner at `at`."""
        rep = api.geometry.add_wall_representation(
            self.f, context=self.body, length=size[0], thickness=size[1], height=size[2]
        )
        api.geometry.assign_representation(self.f, product=el, representation=rep)
        matrix = numpy.eye(4)
        matrix[:3, 3] = at
        api.geometry.edit_object_placement(self.f, product=el, matrix=matrix)

    def pset(self, el, name: str, **props):
        ps = api.pset.add_pset(self.f, product=el, name=name)
        api.pset.edit_pset(self.f, pset=ps, properties=props)

    def manufacturer(self, el, value: str):
        self.pset(el, "Pset_ManufacturerTypeInformation", Manufacturer=value)

    def spatial(self, storeys: int = 2, building: bool = True):
        site = self.add("IfcSite", "Site")
        self.aggregate(self.project, site)
        if not building:
            return site, []
        bldg = self.add("IfcBuilding", "Building")
        self.aggregate(site, bldg)
        levels = [self.add("IfcBuildingStorey", f"Level {i + 1:02d}") for i in range(storeys)]
        if levels:
            self.aggregate(bldg, *levels)
        return bldg, levels

    def write(self, path) -> str:
        self.f.write(str(path))
        return str(path)


def build_clean(path) -> str:
    b = Builder()
    _, (l1, l2) = b.spatial()
    room = b.add("IfcSpace", "Mechanical Room")
    b.aggregate(l1, room)

    # Pump: manufacturer on the occurrence, contained in the storey.
    pump = b.add("IfcPump", "Pump 01", Tag="P-01")
    b.manufacturer(pump, "Grundfos")
    b.geometry(pump)
    b.contain(l1, pump)

    # AHU: manufacturer only on its type, contained in a space.
    ahu = b.add("IfcUnitaryEquipment", "AHU 01", Tag="AHU-01")
    ahu_type = b.add("IfcUnitaryEquipmentType", "AHU Type A")
    api.type.assign_type(b.f, related_objects=[ahu], relating_type=ahu_type)
    b.manufacturer(ahu_type, "Trane")
    b.pset(ahu, "Pset_UnitaryEquipmentTypeCommon", Reference="OCC")  # occurrence-only pset
    b.geometry(ahu)
    b.contain(room, ahu)

    # Valve without geometry, still valid equipment.
    valve = b.add("IfcValve", "Valve 01", Tag="V-01")
    b.manufacturer(valve, "Danfoss")
    b.contain(l2, valve)

    # Assembly in Level 02 with a pump part (part has no direct container).
    skid = b.add("IfcElementAssembly", "Pump Skid")
    b.contain(l2, skid)
    skid_pump = b.add("IfcPump", "Skid Pump", Tag="P-02")
    b.manufacturer(skid_pump, "Wilo")
    b.aggregate(skid, skid_pump)

    # Non-equipment: duct segment, fitting, wall with material.
    duct = b.add("IfcDuctSegment", "Duct 01")
    fitting = b.add("IfcPipeFitting", "Elbow 01")
    wall = b.add("IfcWall", "Wall 01")
    b.geometry(wall)
    concrete = api.material.add_material(b.f, name="Concrete")
    api.material.assign_material(b.f, products=[wall], material=concrete)
    b.contain(l1, duct, fitting, wall)
    return b.write(path)


def build_defects(path) -> str:
    b = Builder()
    _, (l1, _l2) = b.spatial()
    p1 = b.add("IfcPump", "Pump A", Tag="P-1")
    p2 = b.add("IfcPump", "Pump B", Tag="P-1")  # duplicate tag
    for p in (p1, p2):
        b.manufacturer(p, "Grundfos")
    valve = b.add("IfcValve", "Valve no psets", Tag="V-1")  # missing properties + manufacturer
    terminal = b.add("IfcAirTerminal", "Terminal uncontained", Tag="T-1")  # missing manufacturer + container
    b.pset(terminal, "Pset_AirTerminalTypeCommon", Reference="X")
    b.contain(l1, p1, p2, valve)
    return b.write(path)


def build_no_building(path) -> str:
    b = Builder()
    site, _ = b.spatial(building=False)
    pump = b.add("IfcPump", "Pump", Tag="P-1")
    b.manufacturer(pump, "Grundfos")
    b.contain(site, pump)
    return b.write(path)


def build_no_equipment_no_storeys(path) -> str:
    b = Builder()
    bldg, _ = b.spatial(storeys=0)
    b.contain(bldg, b.add("IfcWall", "Wall"))
    return b.write(path)


def build_ifc2x3(path) -> str:
    # ponytail: raw entities; ifcopenshell.api demands owner history setup for IFC2X3
    f = ifcopenshell.file(schema="IFC2X3")
    gid = ifcopenshell.guid.new
    project = f.create_entity("IfcProject", GlobalId=gid(), Name="Project")
    site = f.create_entity("IfcSite", GlobalId=gid(), Name="Site")
    bldg = f.create_entity("IfcBuilding", GlobalId=gid(), Name="Building")
    level = f.create_entity("IfcBuildingStorey", GlobalId=gid(), Name="Level 01")
    fan = f.create_entity("IfcFlowMovingDevice", GlobalId=gid(), Name="Fan", ObjectType="Fan", Tag="F-1")
    duct = f.create_entity("IfcFlowSegment", GlobalId=gid(), Name="Duct")
    for parent, child in ((project, site), (site, bldg), (bldg, level)):
        f.create_entity("IfcRelAggregates", GlobalId=gid(), RelatingObject=parent, RelatedObjects=[child])
    f.create_entity("IfcRelContainedInSpatialStructure", GlobalId=gid(), RelatingStructure=level, RelatedElements=[fan, duct])
    f.write(str(path))
    return str(path)


def build_corrupt(path) -> str:
    with open(path, "w") as fh:
        fh.write("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n")  # truncated
    return str(path)


def build_unsupported_schema(path) -> str:
    build_clean(path)
    text = open(path).read().replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('IFC2X2_FINAL'))")
    with open(path, "w") as fh:
        fh.write(text)
    return str(path)
