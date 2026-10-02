FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt requirements-dev.txt ./
# ponytail: dev deps baked in so `docker compose run api pytest` works; split a prod stage at deploy time
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
