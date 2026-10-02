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
  app/ifc/extract.py      open_model (FatalIfcError), extract -> rows, is_equipment, spatial_parent
  app/ifc/validate.py     11 checks -> {summary, checks}
  app/processing.py       process_model(model_id): one txn for elements + status; never raises
  app/routes/             projects.py, models.py (upload/list/get/file), elements.py (list, one, global-ids, spatial-tree)
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

- `process_model` deletes elements on failure too, so a model that failed after an earlier success has no stale rows.
- Duplicate GlobalIds: `store` keeps the first; validation reports all.
- Upload streams to `{UPLOAD_DIR}/{uuid}.ifc` before the DB insert, so an over-limit upload leaves no row. Starlette has already spooled the multipart body, so the cap bounds disk writes, not network receive.
- `MAX_UPLOAD_MB` env (default 200) exists so tests can exercise 413.
- Executor: `ProcessPoolExecutor(max_workers=1, spawn)`. Tests swap `app.state.executor` for an inline one.
- Version race on concurrent uploads to one project → UNIQUE violation (500). Marked `ponytail:`; retry if multi-user.
- **Deviation from design:** routes return plain dict rows rather than Pydantic response models. The OpenAPI schemas are therefore untyped; add response models if the API gets external consumers.
- `httpx2` is used for TestClient (Starlette deprecates `httpx`).

## Demo models

- `samples/demo-plant.ifc`: generated, committed. 3 storeys × (slab, 4 walls, Mechanical Room + Office spaces, supply duct, 4 air terminals, fan, 2 valves); L01 boiler + 4 pumps; L03 chiller + 2 AHUs. Defects: duplicate tag `P-01`, AHU-02 and V-03 without manufacturer, AT-08 uncontained.
- Duplex apartment MEP (IFC2X3): download manually from WBDG "Common BIM Files" (https://www.wbdg.org/bim/cobie/common-bim-files). Not committed (licence unstated).
