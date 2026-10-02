---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Planning — `ifc-ingest`

## Milestones

- [x] M1: Stack boots — `docker compose up` runs postgres, api, web; migrations applied.
- [x] M2: Ingest works — upload → `processed` with validation report and elements in Postgres.
- [x] M3: Viewer works — model renders; equipment list ↔ 3D; tree isolate; hide/isolate/highlight.
- [x] M4: Verified — tests per testing doc pass; demo model end-to-end; README run instructions.

## Task Breakdown

### Phase 1: Foundation

- [x] 1.1 Repo layout + `docker-compose.yml` (postgres:16, api, web, `uploads` volume), `.gitignore`. *Validation:* `docker compose up` healthy. *Done:* postgres + api; `web` service added in 3.2. Makefile dropped (compose commands suffice).
- [x] 1.2 FastAPI skeleton: Dockerfile (python:3.12 + `ifcopenshell`), settings from env, psycopg 3 pool, Alembic migration with the design schema (run on container start), `/health`, `{error}` exception handlers, pytest setup. *Validation:* migration applies; `/health` 200.
- [x] 1.4 Synthetic fixtures `make_fixtures.py` (clean, defects, assembly, no-geometry element, corrupt). *Tests:* fixture-based ifc tests.
- [x] 1.5 Demo models: generated `samples/demo-plant.ifc` (IFC4, 3 storeys, 29 equipment, deliberate defects; `api/samples_demo_plant.py`) committed. Real-world Duplex MEP (IFC2X3, WBDG Common BIM Files) documented as a manual download (WBDG blocks scripted downloads; licence unstated, so not committed). buildingSMART IFC4 Simple-Scene HVAC rejected: 2 terminals, no psets.

### Phase 2: Ingest

- [x] 2.1 `app/ifc/`: `open_model` + schema check, `is_equipment`, `extract` (express_id, parent/storey incl. assemblies, psets merged, materials, has_geometry). *Tests:* ifc classification + extraction cases.
- [x] 2.2 `app/ifc/validate.py` (11 checks, cap 100 ids). *Tests:* validation cases.
- [x] 2.3 `app/processing.py`: `process_model(model_id)` job — open, extract, validate, then one transaction: DELETE + COPY elements, UPDATE model `processed`; on exception rollback + `failed`. *Tests:* processing cases.
- [x] 2.4 API projects (create/list, 409). *Tests:* api project cases.
- [x] 2.5 Upload route (stream in chunks with 200 MB cap → 413, `.ifc` only, `/data/uploads/{id}.ifc`, version increment, 202 + Location) → `executor.submit(process_model, id)`; startup sweep. *Tests:* api upload/status cases.
- [x] 2.6 Read routes: models list/get, `/file` (`FileResponse`, 409 unless processed), `/elements` (filters, paging), `/elements/{gid}`, `/global-ids`, `/spatial-tree`. *Tests:* api read cases.

### Phase 3: Web + viewer

- [x] 3.1 **Viewer spike** (time-box ½ day): That Open v3 load IFC from ArrayBuffer with local WASM + fragments worker in Vite; confirm click → localId, GUID lookup API, highlight-by-id, Hider, camera fit. Decide `idMap` strategy. *Output:* notes in implementation doc.
- [x] 3.2 Web shell: Vite React TS, `ProjectPicker`, `UploadForm`, `ModelList` with 2 s polling, `ValidationReport`. *Tests:* polling/state tests.
- [x] 3.3 `ModelViewer` + `idMap.ts` + `ElementPanel` (click → details, "No data", WebGL2 check, disabled unless processed). *Tests:* web viewer logic cases.
- [x] 3.4 `EquipmentPanel` (all pages, search, no-geometry badge) ↔ viewer selection; highlight-all-equipment; hide/isolate/show all. *Tests:* panel cases.
- [x] 3.5 `SpatialTree` + storey/space isolate. *Tests:* tree isolate cases.

- [x] 3.6 Keyboard shortcuts (I isolate, H hide, A show all, Esc deselect, F frame all, Shift+F frame selection), ignored while typing; double-click frames the selection. *Source:* ifc-viewx `controls.ts:768-825`, `main.ts:2569-2686`. *Tests:* App keyboard cases.
- [x] 3.7 Storey navigator: isolate a storey without moving the camera, click again to release, ▲/▼ to step levels; the spatial tree shares the same state. Ceiling cut deferred to slice 3 (needs Clipper). *Source:* ifc-viewx `plugins/storeys/panel.ts`. *Tests:* navigator cases.
- [x] 3.8 Validation findings clickable: select and frame the finding's elements; panel shows "N elements selected". Selection becomes a list of GlobalIds. *Source:* ifc-viewx `model-health` finding pattern. *Tests:* finding cases.

### Phase 4: Integration & polish

- [x] 4.1 Integration tests on compose stack (defects fixture, corrupt, v2, demo model).
- [x] 4.2 Playwright E2E (upload → processed → viewer round-trip via test hook).
- [x] 4.3 README: positioning, architecture diagram, run instructions, demo model credit.

## Dependencies

- 1.1 → everything. 1.2 schema → 2.3–2.6.
- 1.4 → 2.1–2.3 tests. 1.5 → 3.1 spike, 4.1.
- 3.1 decides `idMap` → 3.3–3.5. 2.6 → 3.2–3.5.
- IFC logic (2.1–2.2) has no DB dependency and can start right after 1.4.

## Timeline & Estimates

| Phase | Estimate |
|---|---|
| 1 Foundation | 1 day |
| 2 Ingest | 1.5 days |
| 3 Web + viewer | 2.5 days (incl. ½-day spike) |
| 4 Integration | 1 day |

Buffer: +30% for That Open v3 API surprises.

## Risks & Mitigation

- **That Open v3 API differs from expectations** (GUID lookup, highlight-by-id) → spike first (3.1); `express_id` fallback for id mapping.
- **web-ifc WASM / fragments worker loading in Vite** → serve both from `public/`, pin versions to match `@thatopen/components` peer deps.
- **IfcOpenShell wheel on arm64 Docker** → use `ifcopenshell` from PyPI (has manylinux aarch64 wheels); fall back to conda image if not.
- **Demo model lacks psets/storeys** → fixtures cover validation; pick a model with MEP content.
- **CPU-heavy IfcOpenShell blocks the API** → runs in a separate process (`ProcessPoolExecutor`), never in the event loop.

## Resources Needed

- Node 24, Docker (local Python is 3.9, so the API runs and is tested in its 3.12 container).
- Libraries: FastAPI, uvicorn, ifcopenshell, psycopg 3 (+ pool), Alembic, pytest, httpx; Vite, React, `@thatopen/components` 3.4, `@thatopen/components-front`, `@thatopen/fragments` 3.4, `web-ifc`, `three`, Vitest, Playwright.

## Progress Summary

*2026-10-02:* Foundation and ingest are done (M1, M2). The backend is one FastAPI service; 73 tests pass at 100% coverage, and a live smoke test through the real process pool processed the demo plant with the expected findings. Scope changes: Go was dropped in favour of all-Python (user decision), the Makefile was dropped, and the demo model is generated rather than downloaded. Next is web + viewer (3.1 spike first), where the main risk is the That Open v3 API surface; the `express_id` fallback is already stored.

*2026-10-02 (later):* Web + viewer done (M3). The trial build confirmed the That Open v3 API: the fragments GUID lookup resolves 59/59 demo elements, and localId equals `express_id`, so the GUID lookup is primary and `express_id` is a proven fallback. Two surprises were fixed: web-ifc had to be pinned to 0.0.77 (That Open 3.4 is built against it; 0.0.78 changed `StreamMeshes`), and the web app is published on host port 3000 because 5173 was already taken on this machine. Remaining: 4.1 compose integration, 4.2 Playwright E2E, 4.3 README.

*2026-10-02 (quick wins):* Added from the ifc-viewx review: keyboard shortcuts plus double-click to frame (3.6), a storey navigator with toggle and stepping shared with the spatial tree (3.7), and clickable validation findings with list selection (3.8). The rest of the ifc-viewx ideas are recorded against slices 3–6 in the requirements roadmap.

*2026-10-02 (phase 4):* All tasks done. Five integration tests run against the live stack (real process pool), and one Playwright E2E covers upload → processed → 3D load, a GlobalId round-trip for all 29 equipment, a real canvas click selecting the schedule row, findings, the storey navigator, and the README screenshot. The E2E surfaced a real race (a stale model-list response overwrote a fresh upload), fixed with latest-request-wins plus a unit test, and a test race (uploading before the new project was selected). README written. Next: dev-lifecycle phase 7 (check implementation), then phases 8 and 9.
