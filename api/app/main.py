import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app import db
from app.routes import elements, models, projects


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.open_pool()
    # Models left 'processing' by a previous run will never finish: their job died with it.
    db.fetch_one("UPDATE ifc_models SET status='failed', error='interrupted' "
                 "WHERE status='processing' RETURNING 1")
    # One slot: IfcOpenShell parsing is CPU-heavy and runs outside the API process.
    executor = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
    app.state.executor = executor
    yield
    executor.shutdown(cancel_futures=True)
    db.close_pool()


app = FastAPI(title="MEP Tracking API", lifespan=lifespan)
app.include_router(projects.router)
app.include_router(models.router)
app.include_router(elements.router)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.get("/health")
def health():
    db.fetch_one("SELECT 1")
    return {"status": "ok"}
