---
phase: requirements
title: Requirements & Problem Understanding
description: Clarify the problem space, gather requirements, and define success criteria
---

# Requirements — `ifc-ingest` (Slice 1 of OpenBIM AssetOps MVP)

Source spec: `openbim_assetops_requirements.md` (§4.1, §5, §6, §9, §10, §26, §27).

OpenBIM AssetOps is an **MEP equipment management system**: equipment from IFC models is tracked and visualized in the browser. Slice 1 delivers the first end-to-end, visual workflow: upload an IFC → it is processed in the background → open it in a That Open 3D viewer in the browser → find, select, and inspect equipment.

## Problem Statement

**What problem are we solving?**

- MEP equipment data (pumps, AHUs, valves, terminals) is locked inside IFC files. Facility teams cannot locate equipment spatially or query its properties without desktop BIM tools.
- Users have no feedback on whether a model is fit for asset management (missing manufacturers, equipment outside any storey, duplicate tags) until something downstream breaks.
- Affected: the facility/BIM user who uploads models and manages building equipment.

## Goals & Objectives

**Primary goals**

- Upload an IFC file into a project; each upload to the same project creates a new model version.
- Process asynchronously: API returns immediately; UI polls status until `processed` or `failed`.
- Validate the model and produce a PASS / WARNING / ERROR report (§5).
- Extract spatial hierarchy and elements (GlobalId, name, ObjectType, entity type, Tag, property sets, materials, spatial parent/storey) into PostgreSQL; psets/materials as `JSONB`.
- Classify equipment with a schema-native rule.
- **Browser 3D viewer (That Open Engine)** for a processed model:
  - load and render the IFC, orbit/pan/zoom, fit-to-model
  - click an element → highlight it and show its data from the DB (looked up by GlobalId)
  - **equipment panel ↔ 3D**: searchable equipment list (name, type, Tag, storey). Clicking a row highlights the element and flies the camera to it; selecting in 3D selects the row
  - highlight all equipment; hide/show and isolate selected elements

**Secondary goals**

- UI for project create/select, upload, model list with live status, validation report, spatial tree.
- Everything runs via `docker compose up`.

**Non-goals (this slice)**

- Status-colored pins and equipment detail cards → slice 3 (needs operational records from slice 2).
- Clipping/sectioning → slice 3.
- 2D floor plan, filters, issues/tasks, dashboard, telemetry → slices 4–7.
- Auth, S3, Redis, PostGIS, version comparison, server-side fragment caching / large-model optimization → Phase 2.

## User Stories & Use Cases

- As a BIM user, I want to create a project by name so that models are grouped per building.
- As a BIM user, I want to upload an IFC and see its status change to `processed` without refreshing.
- As a BIM user, I want a validation report with PASS / WARNING / ERROR items and counts.
- As a BIM user, I want to browse the spatial hierarchy (Project → Site → Building → Storey → Space).
- As a facility user, I want to open the model in 3D in my browser so that I can see where equipment is.
- As a facility user, I want to search the equipment list and click a pump, so that the viewer flies to it and highlights it.
- As a facility user, I want to click any element in 3D and see its IFC type, Tag, storey, and property sets.
- As a facility user, I want to highlight all equipment, or isolate a selection, so that MEP items stand out from walls and slabs.
- As a BIM user, I want re-uploading a revised file to create version 2 without overwriting version 1.

**Edge cases**

- Non-IFC/corrupt file → `failed` with readable error. Unsupported schema (not IFC2X3/IFC4/IFC4X3) → `failed`.
- Valid IFC, zero equipment → `processed`, warning; equipment panel shows empty state.
- Duplicate GlobalIds → first stored, ERROR reported.
- File > 200 MB → HTTP 413.
- API restart mid-processing → stale `processing` set to `failed: interrupted`.
- Viewer opened for a model not yet `processed` → disabled; `failed` → shows error, no viewer.
- Element clicked in 3D with no DB row (e.g. non-product geometry) → panel shows "No data".
- Browser without WebGL2 → message instead of viewer.

## Success Criteria

- [ ] Uploading the demo IFC returns 202 in < 1 s; model reaches `processed` with no manual step.
- [ ] Model metadata shown: filename, schema, version, upload date, status, element count.
- [ ] Validation report covers all design-doc checks; synthetic defect fixture yields exactly the expected findings.
- [ ] Spatial tree matches the demo model's structure.
- [ ] Demo model renders in Chrome/Firefox in < 15 s on a typical laptop and navigates smoothly.
- [ ] Clicking an equipment row highlights and frames the matching 3D element; clicking it in 3D selects the same row (GlobalId round-trip, 100% of equipment in demo model).
- [ ] Clicking any element shows its DB properties (type, Tag, storey, psets).
- [ ] "Highlight equipment", hide, isolate, and show-all work.
- [ ] Version 2 upload leaves version 1 data and viewer intact.
- [ ] Corrupt upload ends `failed` with message; API stays healthy.
- [ ] `docker compose up` from clean checkout brings up web, api, ifc-worker, postgres.

## Constraints & Assumptions

**Technical constraints (decided)**

- Stack: React + TypeScript (Vite), **That Open Engine** (`@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments`, `web-ifc`) on Three.js, Go REST API, Python + IfcOpenShell service, PostgreSQL, Docker Compose.
- **Viewer loading:** browser downloads the original IFC from the API and converts it to fragments client-side with That Open's IFC loader. No server-side geometry. Caching fragments is Phase 2.
- **Element identity:** IFC GlobalId is the join key between viewer and DB (spec §10, §13).
- **Async:** no Redis/queue. Go saves file to Docker volume, sets `processing`, goroutine calls Python over HTTP, sets final status; frontend polls.
- Python (FastAPI) validates/extracts and writes `ifc_elements` directly; Go owns schema/migrations and status.
- **Equipment rule:** `IfcDistributionElement` descendant and not `IfcFlowSegment`/`IfcFlowFitting`.
- Storage: local Docker volume.

**Assumptions (accepted)**

- No auth in MVP. Projects unique by name. Upload limit 200 MB.
- Validation ERRORs don't fail processing; only parse failure / unsupported schema / worker error → `failed`.
- Demo model: public IFC4 model with storeys, MEP equipment, psets (picked in planning). Tests use synthetic IFCs generated with IfcOpenShell.
- Feature key kept as `ifc-ingest` (docs/task already created); scope now includes the viewer.

## Questions & Open Items

- None blocking. Demo-model selection is a planning task.

## MVP Roadmap (later slices, own docs when started)

1. **`ifc-ingest`**: this doc (ingest + 3D viewer + equipment list ↔ 3D).
2. **`equipment-linking`**: operational equipment records (CSV import; asset code, manufacturer, model, status), matching GUID → Asset ID → Tag → Name → Type+Location, confidence, review UI.
3. **`equipment-pins`**: 3D pins at equipment positions, **colored by status** (Operational/Maintenance/Offline/Retired), pin click → detail card (§11), clipping/sectioning.
4. **`floor-plan-2d`**: per-storey plan, pins, 2D ↔ 3D sync via GlobalId.
5. **`viewer-filters`**: storey/entity/equipment type/status/link status/issue status + IFC property filters; Show Only / Hide / Highlight.
6. **`issues-tasks-dashboard`**: issues/tasks on equipment, **issue/task markers and counts on equipment** in viewer, navigate to 2D/3D, interactive dashboard → viewer filters.
7. **`equipment-telemetry`** (added beyond spec): **simulated live sensor data**. A simulator service writes readings (temperature, pressure, power, run state) per equipment into Postgres; viewer/equipment panel polls latest values; threshold breaches color pins and can raise issues. Real ingestion (MQTT/BACnet) can replace the simulator behind the same table later.

Plus MVP deliverables: architecture docs, demo IFC, README, demo GIF.
