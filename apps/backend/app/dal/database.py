import os
from urllib.parse import quote_plus, urlparse

from dotenv import load_dotenv
from sqlalchemy import text
from sqlmodel import Session, create_engine

# Sentinel used when no DATABASE_URL env var is set.
# A real connection attempt will fail immediately with a clear error, but
# importing this module (e.g. in tests that override get_session) is safe.
_DB_URL_NOT_CONFIGURED = "postgresql://not-configured:not-configured@not-configured/not-configured"


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


def _resolve_database_url() -> str:
    """Resolve DATABASE_URL from environment variables.

    Priority: DIRECT_DATABASE_URL > DATABASE_URL.
    Returns the sentinel constant when neither is set so that the module can
    be imported safely (e.g. in tests that override get_session).  Real
    validation happens at application startup via validate_database_url().
    """
    raw = os.getenv("DIRECT_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not raw:
        return _DB_URL_NOT_CONFIGURED
    return _normalize_database_url(raw)


def validate_database_url() -> None:
    """Fail loud at startup if DATABASE_URL is missing or points at localhost.

    Call this from the FastAPI lifespan so misconfigured deployments crash
    immediately with an actionable error instead of returning 5xx on every
    request.

    Raises:
        RuntimeError: if DATABASE_URL is unset or resolves to a localhost
            address outside of a local/development/test environment.
    """
    if DATABASE_URL == _DB_URL_NOT_CONFIGURED:
        raise RuntimeError(
            "\n"
            "DATABASE_URL is not set — the backend cannot start.\n"
            "\n"
            "Set it in apps/backend/.env (copy from apps/backend/.env.example).\n"
            "Expected format — Supabase transaction-mode pooler (aws-1 region):\n"
            "\n"
            "  DATABASE_URL=postgresql://postgres.{project-ref}:{password}"
            "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require\n"
            "\n"
            "Get the exact URL from:\n"
            "  Supabase Dashboard → Project Settings → Database → "
            "Connection string → Transaction mode\n"
            "Note: use the aws-1-* host, NOT aws-0-* (different region prefix).\n"
        )

    env = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "")).lower()
    is_local = env in {"local", "development", "dev", "test"}

    if not is_local:
        hostname = urlparse(DATABASE_URL).hostname or ""
        localhost_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "not-configured"}
        if hostname in localhost_hosts:
            raise RuntimeError(
                f"\n"
                f"DATABASE_URL resolves to '{hostname}', which is a localhost address.\n"
                f"This will not connect to Supabase in a deployed environment.\n"
                f"\n"
                f"  Got: {DATABASE_URL!r}\n"
                f"\n"
                f"Set DATABASE_URL to your Supabase pooler URL, e.g.:\n"
                f"  postgresql://postgres.{{ref}}:{{pass}}"
                f"@aws-1-{{region}}.pooler.supabase.com:6543/postgres?sslmode=require\n"
                f"\n"
                f"To suppress this check in local dev: "
                f"set APP_ENV=development in your .env\n"
            )


load_dotenv()

DATABASE_URL = _resolve_database_url()

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
