import os
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from app import db
from app.processing import process_model, upload_path

router = APIRouter(prefix="/api")

MODEL_COLUMNS = ("id, project_id, version, filename, ifc_schema, status, error, "
                 "element_count, validation, uploaded_at, processed_at")
CHUNK = 1024 * 1024


def max_upload_bytes() -> int:
    return int(float(os.environ.get("MAX_UPLOAD_MB", "200")) * 1024 * 1024)


def get_model(model_id: uuid.UUID) -> dict:
    model = db.fetch_one(f"SELECT {MODEL_COLUMNS} FROM ifc_models WHERE id=%s", (model_id,))
    if not model:
        raise HTTPException(404, "Model not found")
    return model


@router.post("/projects/{project_id}/models", status_code=202)
def upload_model(project_id: uuid.UUID, file: UploadFile, request: Request, response: Response):
    if not db.fetch_one("SELECT 1 FROM projects WHERE id=%s", (project_id,)):
        raise HTTPException(404, "Project not found")
    if not (file.filename or "").lower().endswith(".ifc"):
        raise HTTPException(400, "Only .ifc files are accepted")

    model_id = uuid.uuid4()
    path, limit, size = upload_path(model_id), max_upload_bytes(), 0
    with open(path, "wb") as out:
        while chunk := file.file.read(CHUNK):
            size += len(chunk)
            if size > limit:
                break
            out.write(chunk)
    if size > limit:
        os.remove(path)
        raise HTTPException(413, f"File exceeds {limit // (1024 * 1024)} MB limit")

    # ponytail: concurrent uploads to one project can race on version; the UNIQUE constraint
    # turns that into a 500. Retry on UniqueViolation if multi-user uploads happen.
    model = db.fetch_one(
        f"INSERT INTO ifc_models (id, project_id, version, filename) "
        f"SELECT %s, %s, COALESCE(MAX(version), 0) + 1, %s FROM ifc_models WHERE project_id=%s "
        f"RETURNING {MODEL_COLUMNS}",
        (model_id, project_id, file.filename, project_id),
    )
    request.app.state.executor.submit(process_model, str(model_id))
    response.headers["Location"] = f"/api/models/{model_id}"
    return model


@router.get("/projects/{project_id}/models")
def list_models(project_id: uuid.UUID):
    return db.fetch_all(
        f"SELECT {MODEL_COLUMNS} FROM ifc_models WHERE project_id=%s ORDER BY version DESC",
        (project_id,),
    )


@router.get("/models/{model_id}")
def read_model(model_id: uuid.UUID):
    return get_model(model_id)


@router.get("/models/{model_id}/file")
def read_model_file(model_id: uuid.UUID):
    model = get_model(model_id)
    if model["status"] != "processed":
        raise HTTPException(409, f"Model is {model['status']}")
    return FileResponse(upload_path(model_id), media_type="application/octet-stream",
                        filename=model["filename"])
