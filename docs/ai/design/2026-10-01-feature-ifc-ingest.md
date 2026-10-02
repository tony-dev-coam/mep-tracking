---
phase: design
title: System Design & Architecture
description: Define the technical architecture, components, and data models
---

# Design — `ifc-ingest`

## Architecture Overview

```mermaid
graph TD
  Web[React + TS web] -->|REST, polls status| API
  Web --> Viewer[That Open viewer<br/>components + fragments + web-ifc<br/>on Three.js]
  Viewer -->|GET /api/models/:id/file| API
  subgraph API[api: Python FastAPI service]
    Routes[REST routes] -->|submit model_id| Pool[ProcessPoolExecutor<br/>max_workers=1]
    Pool --> Job[process_model<br/>IfcOpenShell validate + extract]
  end
  Routes -->|save file| Vol[(uploads volume)]
  Job -->|read file| Vol
  Routes -->|projects, ifc_models, reads| PG[(PostgreSQL)]
  Job -->|ifc_elements + final status, one txn| PG
```

```mermaid
sequenceDiagram
  participant W as Web
  participant A as FastAPI routes
  participant P as process_model (pool process)
  participant D as Postgres
  W->>A: POST /api/projects/:id/models (multipart)
  A->>A: write file to /data/uploads/{model_id}.ifc
  A->>D: INSERT ifc_models (status=processing, version=max+1)
  A-->>W: 202 {id, status: processing}
  A->>P: executor.submit(process_model, model_id)
  P->>P: open, validate, extract (IfcOpenShell)
  P->>D: txn: DELETE + COPY ifc_elements, UPDATE model processed
  P->>D: on exception: rollback, UPDATE model failed + error
  loop every 2s while processing
    W->>A: GET /api/models/:id
  end
```

| Component | Responsibility |
|---|---|
| `web/` | Vite + React + TS. Project picker, upload, model list, validation report, spatial tree, **3D viewer + equipment panel**. |
| `api/` | **Python 3.12, FastAPI, IfcOpenShell, psycopg 3, Alembic.** All backend logic: REST, file intake, background IFC processing (validate, extract, classify, bulk insert), status lifecycle, migrations. |
| `postgres` | PostgreSQL 16. |
| `docker-compose.yml` | Wires web, api, postgres + `uploads` volume. |

## Data Models

```sql
CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE model_status AS ENUM ('processing', 'processed', 'failed');

CREATE TABLE ifc_models (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version       int  NOT NULL,
  filename      text NOT NULL,
  ifc_schema    text,                 -- IFC2X3 / IFC4 / IFC4X3, set after processing
  status        model_status NOT NULL DEFAULT 'processing',
  error         text,
  element_count int,                  -- non-spatial products extracted
  validation    jsonb,                -- see Validation report
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (project_id, version)
);

CREATE TABLE ifc_elements (
  id                 bigserial PRIMARY KEY,
  model_id           uuid NOT NULL REFERENCES ifc_models(id) ON DELETE CASCADE,
  global_id          text NOT NULL,
  express_id         int  NOT NULL,   -- STEP id (#123); same in IfcOpenShell and web-ifc
  ifc_type           text NOT NULL,   -- e.g. IfcPump
  name               text,
  object_type        text,
  tag                text,
  parent_global_id   text,            -- spatial parent: containing/aggregating spatial element
  storey_global_id   text,            -- nearest IfcBuildingStorey ancestor (walks up through element assemblies)
  is_spatial         bool NOT NULL,   -- Project/Site/Building/Storey/Space
  is_equipment       bool NOT NULL,
  has_geometry       bool NOT NULL,   -- element has a Representation (renderable)
  properties         jsonb NOT NULL DEFAULT '{}',  -- {"Pset_X": {"Prop": value}}
  materials          jsonb NOT NULL DEFAULT '[]',  -- ["Steel", ...]
  UNIQUE (model_id, global_id)
);
CREATE INDEX ON ifc_elements (model_id, is_equipment);
CREATE INDEX ON ifc_elements (model_id, storey_global_id);
CREATE INDEX ON ifc_elements USING gin (properties);
```

- Upload path is derived, not stored: `/data/uploads/{model_id}.ifc`.
- Spatial structure lives in `ifc_elements` (`is_spatial`, `parent_global_id`), so no separate `spatial_locations` table. That table gets added if PostGIS/2D needs it.
- Only `IfcProduct` instances are extracted (plus `IfcProject`). Relationship entities are flattened into `parent_global_id`; richer relationships are added when a slice needs them.
- Version = `COALESCE(MAX(version),0)+1` per project, computed inside the insert transaction. The unique constraint guards against races.

### Validation report (`ifc_models.validation`)

```json
{ "summary": {"pass": 5, "warning": 3, "error": 1},
  "checks": [
    {"code": "schema", "severity": "PASS", "message": "IFC4", "count": 1, "global_ids": []},
    {"code": "duplicate_tag", "severity": "ERROR", "message": "Duplicate equipment IDs", "count": 5, "global_ids": ["..."]}
  ] }
```

`global_ids` is capped at 100 per check.

| Code | Rule | Severity when violated (PASS otherwise) |
|---|---|---|
| `schema` | Schema in IFC2X3/IFC4/IFC4X3 | fatal → model `failed` |
| `project` | Exactly 1 IfcProject | ERROR |
| `building` | ≥ 1 IfcBuilding | ERROR |
| `storeys` | ≥ 1 IfcBuildingStorey (count reported) | WARNING |
| `elements` | Element count reported | PASS (info) |
| `no_equipment` | ≥ 1 equipment element | WARNING |
| `missing_properties` | Equipment with no property sets | WARNING |
| `missing_manufacturer` | Equipment lacking `Pset_ManufacturerTypeInformation.Manufacturer` (occurrence or type) | WARNING |
| `missing_container` | Equipment with no spatial container | WARNING |
| `duplicate_tag` | Equipment `Tag` (non-empty) shared by > 1 element | ERROR |
| `duplicate_global_id` | GlobalId repeated in file | ERROR |

## API Design

FastAPI (JSON, no auth; OpenAPI docs at `/docs`):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/projects` | `{name}` → 201 project; 409 if name exists |
| GET | `/api/projects` | list |
| POST | `/api/projects/{id}/models` | multipart `file`; `.ifc` only, ≤ 200 MB (413) → 202 model |
| GET | `/api/projects/{id}/models` | list, newest version first |
| GET | `/api/models/{id}` | model incl. `status`, `error`, `validation` (the polling target) |
| GET | `/api/models/{id}/file` | original IFC (`application/octet-stream`), only when `processed`; Starlette `FileResponse` (ETag, Range) |
| GET | `/api/models/{id}/elements/{globalId}` | one element with psets/materials; 404 if absent (viewer click → details) |
| GET | `/api/models/{id}/spatial-tree` | nested tree of spatial elements, each with element counts |
| GET | `/api/models/{id}/global-ids` | same filters as `/elements` (`equipment`, `storey`, `parent`, `type`) → `string[]`, uncapped. Feeds isolate/highlight sets |
| GET | `/api/models/{id}/elements` | query: `equipment=true`, `storey=<gid>`, `parent=<gid>`, `type=IfcPump`, `limit`/`offset` (default 100, max 1000) |

Errors use one shape: `{"error": "message"}`. Upload 202 sets `Location: /api/models/{id}`.

- `GET /health` → 200 when DB reachable.
- Pydantic response models per route; IFC-specific types never leak into responses.

## Component Breakdown

**api (Python package `app/`)**

```text
api/
  app/
    main.py          # FastAPI app, lifespan: DB pool, executor, startup sweep
    db.py            # psycopg pool + small query helpers
    routes/          # projects.py, models.py, elements.py
    processing.py    # process_model(model_id): runs in the pool process
    ifc/             # open_model, extract, is_equipment, validate (pure, no DB)
  migrations/        # Alembic (raw SQL via op.execute)
  tests/
```

`app/ifc/`
- `open_model(path)` → schema check (fatal).
- `extract(model)` → rows: walk `IfcProduct`s; `express_id = el.id()`; spatial parent via `ifcopenshell.util.element.get_container`, falling back to `get_aggregate` (for spatial elements, and for parts of assemblies, continue up until a spatial element is reached); storey = nearest `IfcBuildingStorey` ancestor; `has_geometry = el.Representation is not None`; psets via `ifcopenshell.util.element.get_psets` (occurrence merged over type); materials via `get_materials`.
- `is_equipment(el)` → `el.is_a("IfcDistributionElement") and not (el.is_a("IfcFlowSegment") or el.is_a("IfcFlowFitting"))`.
- `validate(model, rows)` → report from the table above.

`processing.py`
- `process_model(model_id)` runs in the pool process with its own DB connection. Path derived as `/data/uploads/{model_id}.ifc`. It calls `open_model` → `extract` → `validate`, then in **one transaction**: `DELETE` existing rows for the model, `COPY` new rows (duplicate GlobalIds skipped), and `UPDATE ifc_models SET status='processed', ifc_schema, element_count, validation, processed_at`. Any exception → rollback, then `UPDATE … status='failed', error=<message>`. Because elements and status commit together, no orphan rows are possible.

Routes
- Upload streams `UploadFile` to disk in 1 MB chunks, aborting with 413 past 200 MB (also rejects early on `Content-Length`). It then inserts the model and calls `executor.submit(process_model, id)`.
- Lifespan startup: Alembic `upgrade head` runs in the container entrypoint. Then `UPDATE ifc_models SET status='failed', error='interrupted' WHERE status='processing'` (assumes a single API instance).
- Sync DB calls inside `def` routes (FastAPI runs them in its threadpool). Async isn't needed for this load.

**web (React)**
- `ProjectPicker`, `UploadForm`, `ModelList` (polls every 2 s while any model is `processing`), `ValidationReport`, `SpatialTree`. Plain `fetch`; no state library.
- **`ModelViewer`** (That Open Engine v3: `@thatopen/components` 3.4, `@thatopen/components-front`, `@thatopen/fragments` 3.4, `web-ifc` ≥ 0.0.77, `three` ≥ 0.182):
  - `Components` + `Worlds` (scene, `SimpleRenderer`/`PostproductionRenderer`, orthographic/perspective camera with camera-controls), `Grids`.
  - Fragments worker initialised from the `@thatopen/fragments` worker file; `IfcLoader` with web-ifc WASM served from `web/public/wasm/` (no CDN at runtime).
  - Load: fetch `/api/models/{id}/file` → `ArrayBuffer` → `IfcLoader.load` → fragments model → fit camera.
  - Selection: `Highlighter` (components-front) on click → fragment localId → GlobalId → `GET /elements/{globalId}` → `ElementPanel`.
  - Panel → 3D: GlobalIds → localIds → `Highlighter.highlightByID` + camera fit to the item's bounding box.
  - **Id mapping** is one module `idMap.ts` (`toGlobalIds(localIds)`, `toLocalIds(globalIds)`). Primary: fragments model GUID lookup. Fallback: localId = `express_id` from the DB (one `/elements` fetch builds the map). The spike decides which; callers don't care.
  - `Hider` for hide / isolate / show all. "Highlight equipment" uses a second highlighter style over `/global-ids?equipment=true`.
  - Exact v3 method names are confirmed against the installed typings during implementation (planning task: viewer spike).
- **`SpatialTree` → viewer**: storey click → `/global-ids?storey=<gid>`, space click → `/global-ids?parent=<gid>` → `idMap.toLocalIds` → `Hider.isolate`. The DB is the source of truth for spatial membership, so the tree, 3D, and the later 2D plan agree.
- **`EquipmentPanel`**: searchable list from `/elements?equipment=true`, fetching all pages (client-side filter on name/Tag/type/storey; "no geometry" badge from `has_geometry`; ponytail: fine to ~10k equipment, server-side search when larger), selection shared with the viewer through one `selectedGlobalId` state in the page.
- **`ElementPanel`**: type, name, Tag, storey, psets table.

## Design Decisions

| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Backend language | Python only | Go API + Python worker | One language and one service; IfcOpenShell is Python anyway. Fewer containers, no internal HTTP contract. |
| Async | In-process `ProcessPoolExecutor` + client polling | Redis/Celery; Postgres job table; `BackgroundTasks` | Separate process keeps CPU-heavy parsing off the API's GIL. Restart recovery is covered by the startup sweep. Revisit when processing must survive restarts or scale out. |
| DB access | psycopg 3 + SQL, Alembic migrations | SQLAlchemy ORM | Schema is small and query-shaped (JSONB, COPY). Raw SQL keeps COPY and GIN queries direct. |
| Storage | Docker volume | MinIO/S3 | Deferred to Phase 2 cloud deployment. |
| Spatial model | Rows in `ifc_elements` | Separate `spatial_locations` | One table, one query path. Split out when 2D/PostGIS needs it. |
| Viewer geometry | Browser converts IFC → fragments (That Open `IfcLoader`) | Server-side conversion + cached `.frag` | No extra service; demo model is small. Fragment caching is Phase 2 large-model optimization. |
| Viewer ↔ DB key | IFC GlobalId | fragment localId / express ID | GlobalId is stable across tools and versions, and later slices (linking, 2D sync, BCF) use it too. |
| Spatial membership for isolate | DB `storey_global_id` | That Open's in-browser spatial structure | Same answer in tree, 3D, 2D (slice 4), and filters (slice 5). |
| Id mapping fallback | Store `express_id` | Rely only on fragments GUID API | STEP ids are shared by IfcOpenShell and web-ifc for the same file. Removes the main viewer risk for one int column. |
| Equipment rule | `IfcDistributionElement` minus segments/fittings | Allow-list; whole subtree | Schema-native, works on any MEP model. |

## Non-Functional Requirements

- Performance: demo model (~2k elements) processed in < 30 s; elements inserted via `COPY`. Viewer: demo model loaded in < 15 s, interactive frame rate on a laptop GPU.
- Compatibility: WebGL2 required; viewer shows a message otherwise.
- Upload: file streamed to disk, not buffered in memory; 200 MB cap.
- Reliability: processing exception → `failed` with message, elements rolled back; reprocessing is idempotent.
- Security: only `.ifc` extension accepted, and files saved under a server-generated name (`{model_id}.ifc`), so no client path is used. Postgres is not exposed outside the compose network.
