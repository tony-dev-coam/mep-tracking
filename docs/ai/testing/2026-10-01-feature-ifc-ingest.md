---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy — `ifc-ingest`

## Test Coverage Goals

- Unit: 100% of new logic in `api/` (IFC validate/extract/classify, processing job, routes); app startup wiring excluded.
- Integration: FastAPI app + real Postgres via docker compose (critical paths + failure modes).
- E2E: upload → poll → report in the browser, one manual run recorded per release.

## Unit Tests

### ifc: equipment classification

- [ ] `IfcPump`, `IfcUnitaryEquipment`, `IfcFlowTerminal`, `IfcValve` → equipment
- [ ] `IfcDuctSegment`, `IfcPipeFitting` (segment/fitting subtypes) → not equipment
- [ ] `IfcWall`, `IfcSpace` → not equipment
- [ ] IFC2X3 equivalents (`IfcFlowMovingDevice` with ObjectType) classified the same

### ifc: extraction

- [ ] Spatial tree Project → Site → Building → Storey(×2) → Space reconstructed via `parent_global_id`
- [ ] Equipment in a Space gets `storey_global_id` of the enclosing storey
- [ ] Property sets from type object merged under occurrence values (occurrence wins)
- [ ] Materials extracted for element with single material and with a layer set
- [ ] Element with no container → `parent_global_id` null
- [ ] `has_geometry` true for element with Representation, false without
- [ ] `express_id` equals the STEP id of the source entity
- [ ] Part of an `IfcElementAssembly` contained in a storey gets that storey's `storey_global_id`

### ifc: validation

- [ ] Clean fixture → all checks PASS
- [ ] Defect fixture → exactly: 2 `missing_manufacturer`, 1 `missing_container`, 1 `missing_properties`, `duplicate_tag` count 2, each with the right `global_ids`
- [ ] No IfcBuilding → `building` ERROR; 0 storeys → `storeys` WARNING
- [ ] Model with no equipment → `no_equipment` WARNING
- [ ] `global_ids` capped at 100
- [ ] Unsupported schema / non-IFC file → fatal error raised (job marks model `failed`)

### processing: store + job

- [ ] Rows inserted with JSONB properties queryable (`properties->'Pset_ManufacturerTypeInformation'->>'Manufacturer'`)
- [ ] Re-running for the same `model_id` replaces rows (no duplicates)
- [ ] Duplicate GlobalId in file → first kept, insert does not fail

### api routes (pytest + httpx `TestClient`)

- [ ] Create project; duplicate name → 409
- [ ] Upload non-`.ifc` → 400; > 200 MB → 413
- [ ] Upload → 202, row `processing`, file at `{model_id}.ifc`
- [ ] Versions increment per project (1, 2) and are independent across projects
- [ ] Job success → `processed` with schema/count/validation stored, elements committed in the same transaction
- [ ] Job exception → `failed` with error; no `ifc_elements` rows left (transaction rolled back)
- [ ] Job opens `/data/uploads/{model_id}.ifc` derived from the id
- [ ] Upload submits job to the executor (executor stubbed to run inline in tests)
- [ ] Upload 202 has `Location` header; all errors return `{error}`
- [ ] Startup sweep marks stale `processing` as `failed: interrupted`
- [ ] `/global-ids` applies the same filters, returns uncapped `string[]`
- [ ] Elements endpoint filters (`equipment`, `storey`, `type`) and pagination limits (max 1000)
- [ ] Spatial-tree endpoint nests correctly

### api: file + element lookup

- [ ] `/models/{id}/file` returns bytes for `processed`, 409 for `processing`/`failed`, 404 unknown
- [ ] `/models/{id}/elements/{globalId}` returns psets; 404 for unknown GlobalId

### web: viewer logic (Vitest, That Open mocked at module boundary)

- [ ] `idMap` round-trips GlobalId ↔ localId for both strategies (fragments GUID lookup, `express_id` fallback)

- [ ] localId → GlobalId → `/elements/{gid}` called on 3D selection; panel shows "No data" on 404
- [ ] Equipment row click → highlight + camera fit invoked with matching localIds
- [ ] 3D selection of equipment selects matching row; non-equipment selection clears row
- [ ] Equipment search filters by name/Tag/type/storey
- [ ] Equipment panel fetches all pages when > 1000 equipment; no-geometry row shows badge and skips camera fit
- [ ] Storey click in spatial tree isolates that storey's localIds; space click isolates space children; show all restores
- [ ] Viewer disabled while `processing`; error shown for `failed`; WebGL2 missing → message

## Integration Tests

- [ ] compose stack: upload synthetic defect fixture → poll → `processed`, validation matches expected
- [ ] Upload corrupt file → `failed`; API `/health` still OK
- [ ] Upload v2 to same project → v1 elements unchanged
- [ ] Demo model end-to-end: spatial tree storeys match file; equipment count > 0

## End-to-End Tests

- [ ] Browser: create project → upload demo IFC → status flips to Processed without reload → validation report, spatial tree, equipment table render
- [ ] Browser: upload corrupt file → Failed with message shown
- [ ] Browser: open demo model in 3D → renders; click equipment row → element highlighted and framed; click element in 3D → row selected + properties shown
- [ ] Browser: highlight all equipment, isolate selection, hide, show all
- [ ] Browser: GlobalId round-trip for every equipment element of demo model (scripted check in Playwright via exposed viewer test hook)

## Test Data

- `api/tests/fixtures/make_fixtures.py`: builds `clean.ifc` and `defects.ifc` with `ifcopenshell.api` (deterministic, committed generator, files generated in a pytest session fixture).
- `corrupt.ifc`: truncated text file.
- Demo model: public IFC4 MEP sample (selected in planning), stored in `samples/`.
- Test DB: Postgres from compose, Alembic-migrated once per session; tables truncated between tests.

## Test Reporting & Coverage

- `docker compose run --rm api pytest --cov=app --cov-report=term-missing`
- Record results and gaps here after Phase 8.

## Manual Testing

- Upload form keyboard-accessible; status changes announced (`aria-live` on status cell).
- Chrome + Firefox latest; viewer smoothness on a laptop GPU.

## Performance Testing

- Demo model processing time logged by the job; target < 30 s.

## Bug Tracking

- Bugs logged as task blockers/events on `ifc-ingest`; regression test added with each fix.
