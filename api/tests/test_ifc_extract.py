import pytest

from app.ifc import FatalIfcError, extract, is_equipment, open_model


@pytest.fixture(scope="module")
def clean_rows(ifc):
    rows = extract(open_model(ifc["clean"]))
    return {r["name"]: r for r in rows}


# --- equipment classification -------------------------------------------------

@pytest.mark.parametrize("name", ["Pump 01", "AHU 01", "Valve 01", "Skid Pump"])
def test_distribution_equipment_is_equipment(clean_rows, name):
    assert clean_rows[name]["is_equipment"] is True


@pytest.mark.parametrize("name", ["Duct 01", "Elbow 01", "Wall 01", "Mechanical Room", "Pump Skid"])
def test_segments_fittings_and_building_elements_are_not_equipment(clean_rows, name):
    assert clean_rows[name]["is_equipment"] is False


def test_ifc2x3_flow_moving_device_is_equipment_but_flow_segment_is_not(ifc):
    model = open_model(ifc["ifc2x3"])
    assert is_equipment(model.by_type("IfcFlowMovingDevice")[0])
    assert not is_equipment(model.by_type("IfcFlowSegment")[0])


# --- spatial structure ----------------------------------------------------------

def test_spatial_tree_reconstructed_through_parent_ids(clean_rows):
    gid = {n: r["global_id"] for n, r in clean_rows.items()}
    assert clean_rows["Project"]["parent_global_id"] is None
    assert clean_rows["Site"]["parent_global_id"] == gid["Project"]
    assert clean_rows["Building"]["parent_global_id"] == gid["Site"]
    assert clean_rows["Level 01"]["parent_global_id"] == gid["Building"]
    assert clean_rows["Mechanical Room"]["parent_global_id"] == gid["Level 01"]
    assert all(clean_rows[n]["is_spatial"] for n in ["Project", "Site", "Building", "Level 01", "Mechanical Room"])
    assert not clean_rows["Pump 01"]["is_spatial"]


def test_equipment_in_space_gets_space_parent_and_enclosing_storey(clean_rows):
    ahu = clean_rows["AHU 01"]
    assert ahu["parent_global_id"] == clean_rows["Mechanical Room"]["global_id"]
    assert ahu["storey_global_id"] == clean_rows["Level 01"]["global_id"]


def test_assembly_part_resolves_to_assembly_container_storey(clean_rows):
    part = clean_rows["Skid Pump"]
    assert part["parent_global_id"] == clean_rows["Level 02"]["global_id"]
    assert part["storey_global_id"] == clean_rows["Level 02"]["global_id"]


def test_storey_is_its_own_storey(clean_rows):
    assert clean_rows["Level 01"]["storey_global_id"] == clean_rows["Level 01"]["global_id"]


def test_element_without_container_has_no_parent(ifc):
    rows = {r["name"]: r for r in extract(open_model(ifc["defects"]))}
    assert rows["Terminal uncontained"]["parent_global_id"] is None
    assert rows["Terminal uncontained"]["storey_global_id"] is None


# --- attributes, psets, materials, geometry ---------------------------------------

def test_attributes_and_express_id(clean_rows, ifc):
    pump = clean_rows["Pump 01"]
    model = open_model(ifc["clean"])
    assert pump["ifc_type"] == "IfcPump"
    assert pump["tag"] == "P-01"
    assert pump["express_id"] == model.by_guid(pump["global_id"]).id()


def test_type_psets_merged_under_occurrence(clean_rows):
    props = clean_rows["AHU 01"]["properties"]
    assert props["Pset_ManufacturerTypeInformation"]["Manufacturer"] == "Trane"
    assert props["Pset_UnitaryEquipmentTypeCommon"]["Reference"] == "OCC"
    assert "id" not in props["Pset_ManufacturerTypeInformation"]  # ifcopenshell's internal key stripped


def test_materials_extracted(clean_rows):
    assert clean_rows["Wall 01"]["materials"] == ["Concrete"]
    assert clean_rows["Pump 01"]["materials"] == []


def test_has_geometry_flag(clean_rows):
    assert clean_rows["Pump 01"]["has_geometry"] is True
    assert clean_rows["Valve 01"]["has_geometry"] is False


# --- fatal errors -------------------------------------------------------------

@pytest.mark.parametrize("name", ["corrupt", "unsupported_schema"])
def test_unreadable_or_unsupported_file_is_fatal(ifc, name):
    with pytest.raises(FatalIfcError):
        open_model(ifc[name])


def test_schema_ifcopenshell_reads_but_we_do_not_support_is_fatal(ifc, monkeypatch):
    import ifcopenshell

    real_open = ifcopenshell.open

    class FakeModel:
        schema = "IFC4X1"

    monkeypatch.setattr(ifcopenshell, "open", lambda p: FakeModel() if p == "x" else real_open(p))
    with pytest.raises(FatalIfcError, match="Unsupported IFC schema: IFC4X1"):
        open_model("x")


def test_property_values_made_json_safe():
    from app.ifc.extract import json_safe

    class Entity:
        def __str__(self):
            return "#12=IfcLabel('x')"

    assert json_safe((1, "a", None)) == [1, "a", None]
    assert json_safe([Entity()]) == ["#12=IfcLabel('x')"]
