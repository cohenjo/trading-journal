"""Tests for database URL fail-loud validation.

Ensures the backend refuses to start with a missing or localhost DATABASE_URL
outside of a local development environment.
"""

import pytest
from unittest.mock import patch


class TestValidateDatabaseUrl:
    """validate_database_url() raises on misconfigured DATABASE_URL."""

    def test_raises_when_not_configured(self) -> None:
        """Sentinel DATABASE_URL must raise RuntimeError at startup."""
        from app.dal.database import _DB_URL_NOT_CONFIGURED, validate_database_url
        import app.dal.database as db_module

        with (
            patch.object(db_module, "DATABASE_URL", _DB_URL_NOT_CONFIGURED),
        ):
            with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
                validate_database_url()

    def test_raises_on_localhost_in_production(self) -> None:
        """Localhost DATABASE_URL must raise when APP_ENV is not local/dev/test."""
        from app.dal.database import validate_database_url
        import app.dal.database as db_module

        localhost_url = "postgresql://user:password@localhost:5432/trading-journal"
        with (
            patch.object(db_module, "DATABASE_URL", localhost_url),
            patch.dict("os.environ", {"APP_ENV": ""}, clear=False),
        ):
            with pytest.raises(RuntimeError, match="localhost"):
                validate_database_url()

    def test_raises_on_127_0_0_1_in_production(self) -> None:
        """127.0.0.1 DATABASE_URL must raise when APP_ENV is not local/dev/test."""
        from app.dal.database import validate_database_url
        import app.dal.database as db_module

        loopback_url = "postgresql://user:password@127.0.0.1:5432/trading-journal"
        with (
            patch.object(db_module, "DATABASE_URL", loopback_url),
            patch.dict("os.environ", {"APP_ENV": ""}, clear=False),
        ):
            with pytest.raises(RuntimeError, match="127.0.0.1"):
                validate_database_url()

    def test_localhost_allowed_in_development(self) -> None:
        """Localhost DATABASE_URL must NOT raise when APP_ENV=development."""
        from app.dal.database import validate_database_url
        import app.dal.database as db_module

        localhost_url = "postgresql://user:password@localhost:5432/trading-journal"
        for env in ("development", "dev", "local", "test"):
            with (
                patch.object(db_module, "DATABASE_URL", localhost_url),
                patch.dict("os.environ", {"APP_ENV": env}, clear=False),
            ):
                # Should NOT raise
                validate_database_url()

    def test_valid_supabase_url_passes(self) -> None:
        """A real Supabase pooler URL must pass validation."""
        from app.dal.database import validate_database_url
        import app.dal.database as db_module

        supabase_url = (
            "postgresql://postgres.abcdefghij:s3cr3t"
            "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"
        )
        with (
            patch.object(db_module, "DATABASE_URL", supabase_url),
            patch.dict("os.environ", {"APP_ENV": ""}, clear=False),
        ):
            # Should NOT raise
            validate_database_url()
