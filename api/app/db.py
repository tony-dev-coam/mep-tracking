import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool: ConnectionPool | None = None


def open_pool() -> None:
    global pool
    pool = ConnectionPool(os.environ["DATABASE_URL"], kwargs={"row_factory": dict_row}, open=True)


def close_pool() -> None:
    if pool:
        pool.close()


def fetch_one(sql: str, params=()):
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchone()


def fetch_all(sql: str, params=()):
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()
