import os

from alembic import context
from sqlalchemy import create_engine

url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(url)
with engine.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()  # don't leave a pooled connection behind (matters when run in-process by tests)
