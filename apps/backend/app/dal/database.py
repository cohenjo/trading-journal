import os
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import text
from sqlmodel import Session, create_engine


def _normalize_database_url(raw_url: str) -> str:
    if "://" in raw_url:
        return raw_url

    parts = {}
    for item in raw_url.split(";"):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        parts[key.strip().lower()] = value.strip()

    host = parts.get("host", "localhost")
    port = parts.get("port", "5432")
    database = parts.get("database", "trading-journal")
    username = quote_plus(parts.get("username", "user"))
    password = quote_plus(parts.get("password", "password"))
    return f"postgresql://{username}:{password}@{host}:{port}/{database}"


load_dotenv()

DATABASE_URL = _normalize_database_url(
    os.getenv("DIRECT_DATABASE_URL")
    or os.getenv("DATABASE_URL", "postgresql://user:password@localhost/trading-journal")
)

engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("DATABASE_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
)


def create_db_and_tables():
    # SQLModel.metadata.create_all(engine)
    pass


def check_database_connection() -> bool:
    """Return whether the configured database can execute a trivial query."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 - health endpoint must not leak DB errors
        return False


def get_session():
    with Session(engine) as session:
        yield session
