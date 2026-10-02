"""Generate samples/demo-plant.ifc: a small 3-storey MEP plant model.

Run: docker compose run --rm api python samples_demo_plant.py /samples/demo-plant.ifc
Deterministic content (GlobalIds are random per run). Deliberate defects so the
validation report has something to show: 2 missing manufacturer, 1 duplicate tag,
1 uncontained terminal.
"""

import sys

from tests.fixtures.make_fixtures import Builder

W, D, H = 24.0, 16.0, 3.6  # floor plate width, depth, storey height (m)
MAKERS = {"IfcUnitaryEquipment": "Trane", "IfcPump": "Grundfos", "IfcValve": "Danfoss",
          "IfcAirTerminal": "Trox", "IfcBoiler": "Viessmann", "IfcChiller": "Carrier",
          "IfcFan": "Systemair"}


def build(path: str) -> str:
    b = Builder()
    _, levels = b.spatial(storeys=3)
    for i, level in enumerate(levels):
        level.Elevation = i * H
    counters: dict[str, int] = {}

    def equip(level, cls, prefix, at, size=(1.2, 0.8, 1.0), maker=True, tag=None):
        counters[prefix] = counters.get(prefix, 0) + 1
        tag = tag or f"{prefix}-{counters[prefix]:02d}"
        el = b.add(cls, f"{prefix} {counters[prefix]:02d}", Tag=tag)
        if maker:
            b.manufacturer(el, MAKERS[cls])
        b.pset(el, "Pset_ManufacturerOccurrence", SerialNumber=f"SN-{tag}")
        b.geometry(el, size=size, at=at)
        if level is not None:
            b.contain(level, el)
        return el

    for i, level in enumerate(levels):
        z = i * H
        slab = b.add("IfcSlab", f"Slab L{i + 1:02d}")
        b.geometry(slab, size=(W, D, 0.2), at=(0, 0, z - 0.2))
        walls = [((W, 0.2, H), (0, 0, z)), ((W, 0.2, H), (0, D - 0.2, z)),
                 ((0.2, D, H), (0, 0, z)), ((0.2, D, H), (W - 0.2, 0, z))]
        for n, (size, at) in enumerate(walls):
            wall = b.add("IfcWall", f"Wall L{i + 1:02d}-{n + 1}")
            b.geometry(wall, size=size, at=at)
            b.contain(level, wall)
        b.contain(level, slab)

        mech = b.add("IfcSpace", "Mechanical Room")
        office = b.add("IfcSpace", "Office")
        b.aggregate(level, mech, office)

        # Supply duct run along the corridor (non-equipment) + air terminals.
        duct = b.add("IfcDuctSegment", f"Supply Duct L{i + 1:02d}")
        b.geometry(duct, size=(W - 8, 0.4, 0.3), at=(6, D / 2, z + H - 0.5))
        b.contain(level, duct)
        for n in range(4):
            at = (8 + n * 4, D / 2 - 0.3, z + H - 0.3)
            if i == 1 and n == 3:
                equip(None, "IfcAirTerminal", "AT", at, size=(0.6, 0.6, 0.1))  # defect: uncontained
            else:
                equip(office, "IfcAirTerminal", "AT", at, size=(0.6, 0.6, 0.1))

        # Mechanical room equipment.
        if i == 0:
            equip(mech, "IfcBoiler", "B", (2, 2, z), size=(1.5, 1.0, 1.8))
            for n in range(3):
                equip(mech, "IfcPump", "P", (4.5 + n * 1.2, 2, z), size=(0.6, 0.6, 0.8))
            equip(mech, "IfcPump", "P", (8.5, 2, z), size=(0.6, 0.6, 0.8), tag="P-01")  # defect: duplicate tag
        if i == 2:
            equip(mech, "IfcChiller", "CH", (2, 2, z), size=(3.0, 1.5, 2.0))
            equip(mech, "IfcUnitaryEquipment", "AHU", (6, 2, z), size=(3.0, 1.5, 2.0))
            equip(mech, "IfcUnitaryEquipment", "AHU", (10, 2, z), size=(3.0, 1.5, 2.0), maker=False)  # defect
        equip(mech, "IfcFan", "F", (2, D - 3, z + 2.5), size=(0.8, 0.8, 0.6))
        for n in range(2):
            equip(mech, "IfcValve", "V", (4 + n * 2, D - 3, z + 1), size=(0.3, 0.3, 0.3),
                  maker=not (i == 1 and n == 0))  # defect: one valve without manufacturer
    return b.write(path)


if __name__ == "__main__":
    print(build(sys.argv[1]))
