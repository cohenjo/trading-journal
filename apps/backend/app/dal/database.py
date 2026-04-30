import os
from urllib.parse import quote_plus
from sqlmodel import create_engine, Session


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
    username = quote_plus(parts.get("username", ""))
    password = quote_plus(parts.get("password", ""))
    if username:
        return f"postgresql://{username}:{password}@{host}:{port}/{database}"
    return f"postgresql://{host}:{port}/{database}"


# Primary connection URL — used by the application at runtime.
# Set DATABASE_URL in the environment (e.g. via .env or docker-compose).
# Falls back to a local-dev socket-auth URL when the variable is absent.
DATABASE_URL = _normalize_database_url(
    os.getenv("DATABASE_URL", "postgresql://localhost/trading-journal")
)

# Direct (non-pooled) URL for Alembic migrations and operations that must
# bypass a connection pooler (PgBouncer, Supabase pooler, etc.).
# Defaults to DATABASE_URL when not explicitly provided.
DIRECT_DATABASE_URL = _normalize_database_url(
    os.getenv("DIRECT_DATABASE_URL") or os.getenv("DATABASE_URL", "postgresql://localhost/trading-journal")
)

engine = create_engine(DATABASE_URL, echo=True)


def create_db_and_tables():
    # SQLModel.metadata.create_all(engine)
    pass


def get_session():
    with Session(engine) as session:
        yield session
