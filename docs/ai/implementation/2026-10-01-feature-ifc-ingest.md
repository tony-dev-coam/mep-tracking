---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation — `ifc-ingest`

## Development Setup

```bash
docker compose up -d postgres
docker compose build api
docker compose run --rm api pytest -q            # tests (uses DB mep_test, recreated per session)
docker compose up api                           # API on :8000, OpenAPI at /docs
docker compose run --rm -v "$PWD/samples:/samples" api python samples_demo_plant.py /samples/demo-plant.ifc
```

Local Python is 3.9, so everything Python runs in the `api` container (python:3.12-slim). `./api` is bind-mounted, so code edits need no rebuild.

## Code Structure

```text
docker-compose.yml        postgres:16 + api (+ web in 3.2), volumes pgdata, uploads
api/
  Dockerfile              runs `alembic upgrade head` then uvicorn
  requirements*.txt       pinned (ifcopenshell 0.9.0, fastapi 0.142, psycopg 3.3, alembic 1.20)
  alembic.ini, migrations/ 0001_init.py = design schema (raw SQL)
  app/main.py             FastAPI app, lifespan opens the psycopg pool, {error} handler, /health
  app/db.py               pool + fetch_one / fetch_all
  samples_demo_plant.py   demo model generator (reuses the test Builder)
  tests/conftest.py       mep_test DB + migrations per session; `db`, `client`, `ifc` fixtures
  tests/fixtures/make_fixtures.py  Builder + synthetic models
samples/demo-plant.ifc
```

## Implementation Notes

- Tests run against a real Postgres (`mep_test`), dropped and re-migrated once per session, with `TRUNCATE projects CASCADE` per test. No DB mocks.
- `ifcopenshell.api` submodules must be imported explicitly (`import ifcopenshell.api.root`).
- IFC2X3 fixture uses raw `create_entity`, because `ifcopenshell.api` requires owner-history setup for IFC2X3.
- Corrupt and unsupported-schema files fail at `ifcopenshell.open` (`Error: Unable to parse IFC SPF header`, `SchemaError`). `open_model` maps both to the fatal error.
- `Builder.geometry(size, at)` places an extruded box, which is enough for the viewer and 2D later.

## Demo models

- `samples/demo-plant.ifc`: generated, committed. 3 storeys × (slab, 4 walls, Mechanical Room + Office spaces, supply duct, 4 air terminals, fan, 2 valves); L01 boiler + 4 pumps; L03 chiller + 2 AHUs. Defects: duplicate tag `P-01`, AHU-02 and V-03 without manufacturer, AT-08 uncontained.
- Duplex apartment MEP (IFC2X3): download manually from WBDG "Common BIM Files" (https://www.wbdg.org/bim/cobie/common-bim-files). Not committed (licence unstated).
