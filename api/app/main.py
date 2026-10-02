from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.open_pool()
    yield
    db.close_pool()


app = FastAPI(title="MEP Tracking API", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.get("/health")
def health():
    db.fetch_one("SELECT 1")
    return {"status": "ok"}
