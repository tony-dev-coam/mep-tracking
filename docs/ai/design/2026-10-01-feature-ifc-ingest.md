---
phase: design
title: System Design & Architecture
description: Define the technical architecture, components, and data models
---

# Design — `ifc-ingest`

## Architecture Overview

```mermaid
graph TD
  Web[React + TS web] -->|REST, polls status| API[Go API]
  Web --> Viewer[That Open viewer<br/>components + fragments + web-ifc<br/>on Three.js]
  Viewer -->|GET /api/models/:id/file| API
  API -->|save file| Vol[(uploads volume)]
  API -->|migrations, projects, ifc_models| PG[(PostgreSQL)]
  API -->|goroutine: POST /process| Worker[Python ifc-worker<br/>FastAPI + IfcOpenShell]
  Worker -->|read file| Vol
  Worker -->|insert ifc_elements| PG
```

```mermaid
sequenceDiagram
  participant W as Web
  participant A as Go API
  participant P as ifc-worker
  participant D as Postgres
  W->>A: POST /api/projects/:id/models (multipart)
  A->>A: write file to /data/uploads/{model_id}.ifc
  A->>D: INSERT ifc_models (status=processing, version=max+1)
  A-->>W: 202 {id, status: processing}
  A->>P: POST /process {model_id} (goroutine)
  P->>D: DELETE + INSERT ifc_elements (one txn)
  P-->>A: 200 {schema, element_count, validation} | 422 {error}
  A->>D: UPDATE ifc_models status=processed|failed (on failed: DELETE its ifc_elements)
  loop every 2s while processing
    W->>A: GET /api/models/:id
  end
```

| Component | Responsibility |
|---|---|
| `web/` | Vite + React + TS. Project picker, upload, model list, validation report, spatial tree, **3D viewer + equipment panel**. |
| `api/` | Go (stdlib `net/http` routing, `pgx`). REST, file intake, model status lifecycle, migrations. |
| `ifc-worker/` | Python 3.12, FastAPI, IfcOpenShell. Validate, extract, classify equipment, bulk insert. |
| `postgres` | PostgreSQL 16. |
| `docker-compose.yml` | Wires all four + `uploads` volume. |

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

Go API (JSON, no auth):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/projects` | `{name}` → 201 project; 409 if name exists |
| GET | `/api/projects` | list |
| POST | `/api/projects/{id}/models` | multipart `file`; `.ifc` only, ≤ 200 MB (413) → 202 model |
| GET | `/api/projects/{id}/models` | list, newest version first |
| GET | `/api/models/{id}` | model incl. `status`, `error`, `validation` (the polling target) |
| GET | `/api/models/{id}/file` | original IFC (`application/octet-stream`), only when `processed`; served with `http.ServeContent` (Range/ETag) |
| GET | `/api/models/{id}/elements/{globalId}` | one element with psets/materials; 404 if absent (viewer click → details) |
| GET | `/api/models/{id}/spatial-tree` | nested tree of spatial elements, each with element counts |
| GET | `/api/models/{id}/global-ids` | same filters as `/elements` (`equipment`, `storey`, `parent`, `type`) → `string[]`, uncapped. Feeds isolate/highlight sets |
| GET | `/api/models/{id}/elements` | query: `equipment=true`, `storey=<gid>`, `parent=<gid>`, `type=IfcPump`, `limit`/`offset` (default 100, max 1000) |

Errors use one shape: `{"error": "message"}`. Upload 202 sets `Location: /api/models/{id}`.

Internal Go → worker:

- `POST /process` `{model_id}` (worker derives the path, so it never opens a caller-supplied path) → 200 `{ifc_schema, element_count, validation}` or 422 `{error}`. Synchronous. Go client timeout 10 min.
- `GET /health`.

## Component Breakdown

**ifc-worker (Python)**
- `open_model(path)` → schema check (fatal).
- `extract(model)` → rows: walk `IfcProduct`s; `express_id = el.id()`; spatial parent via `ifcopenshell.util.element.get_container`, falling back to `get_aggregate` (for spatial elements, and for parts of assemblies, continue up until a spatial element is reached); storey = nearest `IfcBuildingStorey` ancestor; `has_geometry = el.Representation is not None`; psets via `ifcopenshell.util.element.get_psets` (occurrence merged over type); materials via `get_materials`.
- `is_equipment(el)` → `el.is_a("IfcDistributionElement") and not (el.is_a("IfcFlowSegment") or el.is_a("IfcFlowFitting"))`.
- `validate(model, rows)` → report from the table above.
- `store(conn, model_id, rows)` → one transaction: `DELETE` existing rows for the model, then `COPY` insert (idempotent retries).

**api (Go)**
- `migrations/` embedded SQL, applied at startup via `golang-migrate`.
- Upload handler streams to disk with `http.MaxBytesReader`, then inserts the model and spawns `go process(modelID)`.
- Startup: `UPDATE ifc_models SET status='failed', error='interrupted' WHERE status='processing'` (assumes a single API instance).
- On worker error/timeout: set `failed` and `DELETE FROM ifc_elements WHERE model_id=$1` (the worker may finish writing after Go gives up).

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
| Async | Goroutine + client polling | Redis queue; Postgres job table | Fewest moving parts. Restart recovery covered by the startup sweep. Revisit when processing must survive restarts or scale out. |
| Go↔Python | Worker HTTP service | Subprocess; worker polling DB | Clean service separation; each side testable alone. |
| Who writes elements | Python, direct to PG | Return JSON to Go | Avoids shipping large payloads over HTTP. Go still owns schema and status. |
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
- Reliability: worker failure or timeout → `failed` with message; reprocessing is idempotent.
- Security: only `.ifc` extension accepted, and files saved under a server-generated name (`{model_id}.ifc`), so no client path is used. Worker is not exposed outside the compose network.
