---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Planning — `ifc-ingest`

## Milestones

- [ ] M1: Stack boots — `docker compose up` runs postgres, api, ifc-worker, web; migrations applied.
- [ ] M2: Ingest works — upload → `processed` with validation report and elements in Postgres.
- [ ] M3: Viewer works — model renders; equipment list ↔ 3D; tree isolate; hide/isolate/highlight.
- [ ] M4: Verified — tests per testing doc pass; demo model end-to-end; README run instructions.

## Task Breakdown

### Phase 1: Foundation

- [ ] 1.1 Repo layout + `docker-compose.yml` (postgres:16, api, ifc-worker, web, `uploads` volume), `.gitignore`, Makefile targets `up`, `test`. *Validation:* `docker compose up` healthy.
- [ ] 1.2 Go API skeleton: config from env, pgx pool, embedded migrations (`golang-migrate`) with the design schema, `/health`, JSON error helper. *Validation:* migration test against compose Postgres.
- [ ] 1.3 Python worker skeleton: FastAPI `/health`, `/process` stub, Dockerfile (python:3.12 + `ifcopenshell`). *Validation:* container health.
- [ ] 1.4 Synthetic fixtures `make_fixtures.py` (clean, defects, assembly, no-geometry element, corrupt). *Tests:* fixture-based worker tests.
- [ ] 1.5 Demo model: pick a public IFC4 MEP sample with storeys/equipment/psets → `samples/`, document source + licence. *Risk:* licence/size.

### Phase 2: Ingest (worker + API)

- [ ] 2.1 Worker `open_model` + schema check, `is_equipment`, `extract` (express_id, parent/storey incl. assemblies, psets merged, materials, has_geometry). *Tests:* worker classification + extraction cases.
- [ ] 2.2 Worker `validate` (11 checks, cap 100 ids). *Tests:* validation cases.
- [ ] 2.3 Worker `store` (DELETE + COPY, one txn, duplicate GlobalId skip) and `/process` wiring (200/422). *Tests:* store cases.
- [ ] 2.4 API projects (create/list, 409). *Tests:* api project cases.
- [ ] 2.5 API upload (MaxBytesReader 200 MB, `.ifc` only, stream to `/data/uploads/{id}.ifc`, version increment, 202 + Location) + goroutine → worker → status update; failure cleanup; startup sweep. *Tests:* api upload/status cases.
- [ ] 2.6 API reads: models list/get, `/file` (ServeContent, 409 unless processed), `/elements` (filters, paging), `/elements/{gid}`, `/global-ids`, `/spatial-tree`. *Tests:* api read cases.

### Phase 3: Web + viewer

- [ ] 3.1 **Viewer spike** (time-box ½ day): That Open v3 load IFC from ArrayBuffer with local WASM + fragments worker in Vite; confirm click → localId, GUID lookup API, highlight-by-id, Hider, camera fit. Decide `idMap` strategy. *Output:* notes in implementation doc.
- [ ] 3.2 Web shell: Vite React TS, `ProjectPicker`, `UploadForm`, `ModelList` with 2 s polling, `ValidationReport`. *Tests:* polling/state tests.
- [ ] 3.3 `ModelViewer` + `idMap.ts` + `ElementPanel` (click → details, "No data", WebGL2 check, disabled unless processed). *Tests:* web viewer logic cases.
- [ ] 3.4 `EquipmentPanel` (all pages, search, no-geometry badge) ↔ viewer selection; highlight-all-equipment; hide/isolate/show all. *Tests:* panel cases.
- [ ] 3.5 `SpatialTree` + storey/space isolate. *Tests:* tree isolate cases.

### Phase 4: Integration & polish

- [ ] 4.1 Integration tests on compose stack (defects fixture, corrupt, v2, demo model).
- [ ] 4.2 Playwright E2E (upload → processed → viewer round-trip via test hook).
- [ ] 4.3 README: positioning, architecture diagram, run instructions, demo model credit.

## Dependencies

- 1.1 → everything. 1.2 schema → 2.3 (worker writes Go-owned tables) and 2.4–2.6.
- 1.4 → 2.1–2.3 tests. 1.5 → 3.1 spike, 4.1.
- 3.1 decides `idMap` → 3.3–3.5. 2.6 → 3.2–3.5.
- Worker (2.1–2.3) and API (2.4–2.6) can proceed in parallel once 1.2 lands.

## Timeline & Estimates

| Phase | Estimate |
|---|---|
| 1 Foundation | 1 day |
| 2 Ingest | 2 days |
| 3 Web + viewer | 2.5 days (incl. ½-day spike) |
| 4 Integration | 1 day |

Buffer: +30% for That Open v3 API surprises.

## Risks & Mitigation

- **That Open v3 API differs from expectations** (GUID lookup, highlight-by-id) → spike first (3.1); `express_id` fallback for id mapping.
- **web-ifc WASM / fragments worker loading in Vite** → serve both from `public/`, pin versions to match `@thatopen/components` peer deps.
- **IfcOpenShell wheel on arm64 Docker** → use `ifcopenshell` from PyPI (has manylinux aarch64 wheels); fall back to conda image if not.
- **Demo model lacks psets/storeys** → fixtures cover validation; pick a model with MEP content.
- **Worker and Go disagree on schema** → worker tests run against the migrated schema from the API's migrations.

## Resources Needed

- Go 1.27, Node 24, Docker (local Python is 3.9, so the worker runs and is tested in its 3.12 container).
- Libraries: pgx, golang-migrate; FastAPI, ifcopenshell, psycopg 3; Vite, React, `@thatopen/components` 3.4, `@thatopen/components-front`, `@thatopen/fragments` 3.4, `web-ifc`, `three`, Vitest, Playwright.
