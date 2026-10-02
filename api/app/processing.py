"""Background IFC processing job. Runs in a ProcessPoolExecutor worker process."""

import json
import os

import psycopg
from psycopg.types.json import Jsonb

from app.ifc import extract, open_model, schema_of, validate

COLUMNS = ("model_id", "global_id", "express_id", "ifc_type", "name", "object_type", "tag",
           "parent_global_id", "storey_global_id", "is_spatial", "is_equipment",
           "has_geometry", "properties", "materials")


def upload_path(model_id) -> str:
    return os.path.join(os.environ["UPLOAD_DIR"], f"{model_id}.ifc")


def process_model(model_id) -> None:
    """Extract and validate the uploaded file; commit elements + final status together.

    Never raises: any failure is recorded on the model row.
    """
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        try:
            model = open_model(upload_path(model_id))
            rows = extract(model)
            report = validate(model, rows)
            with conn.transaction():
                conn.execute("DELETE FROM ifc_elements WHERE model_id=%s", (model_id,))
                store(conn, model_id, rows)
                conn.execute(
                    "UPDATE ifc_models SET status='processed', error=NULL, ifc_schema=%s, "
                    "element_count=%s, validation=%s, processed_at=now() WHERE id=%s",
                    (schema_of(model), sum(not r["is_spatial"] for r in rows), Jsonb(report), model_id),
                )
        except Exception as e:
            conn.rollback()
            with conn.transaction():
                conn.execute("DELETE FROM ifc_elements WHERE model_id=%s", (model_id,))
                conn.execute("UPDATE ifc_models SET status='failed', error=%s WHERE id=%s",
                             (str(e), model_id))


def store(conn, model_id, rows) -> None:
    seen = set()
    with conn.cursor().copy(f"COPY ifc_elements ({', '.join(COLUMNS)}) FROM STDIN") as copy:
        for r in rows:
            if r["global_id"] in seen:  # duplicate GlobalId: keep first, validation reports it
                continue
            seen.add(r["global_id"])
            copy.write_row([model_id, *(r[c] for c in COLUMNS[1:12]),
                            json.dumps(r["properties"]), json.dumps(r["materials"])])
