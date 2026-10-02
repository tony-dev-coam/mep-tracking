import psycopg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app import db

router = APIRouter(prefix="/api/projects")


class ProjectIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()


@router.post("", status_code=201)
def create_project(body: ProjectIn):
    try:
        return db.fetch_one("INSERT INTO projects (name) VALUES (%s) RETURNING *", (body.name,))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Project name already exists")


@router.get("")
def list_projects():
    return db.fetch_all("SELECT * FROM projects ORDER BY created_at DESC")
