"""Supabase JWT validation using JWKS (RS256/ES256) with HS256 fallback.

Validates tokens issued by Supabase Auth, supporting:
- Asymmetric keys (RS256/ES256) fetched from the Supabase JWKS endpoint (preferred).
- Symmetric fallback (HS256) via SUPABASE_JWT_SECRET for local dev / self-hosted.

Usage::

    from app.supabase_auth import verify_supabase_jwt, init_jwks_cache, SupabaseAuthSettings

    settings = SupabaseAuthSettings()
    cache = init_jwks_cache(settings)
    claims = await verify_supabase_jwt(token, settings, cache)
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal, Optional
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt
from pydantic import ConfigDict, EmailStr, Field
from pydantic import BaseModel as PydanticBaseModel
from pydantic import AliasChoices
try:
    from pydantic_settings import BaseSettings
except ImportError:  # pragma: no cover
    from pydantic import BaseModel as BaseSettings  # type: ignore[assignment]

from pydantic import SecretStr

logger = logging.getLogger(__name__)

# Algorithms considered asymmetric — verified via JWKS public key
_ASYMMETRIC_ALGS: frozenset[str] = frozenset(
    {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}
)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SupabaseAuthSettings(BaseSettings):
    """Runtime configuration for Supabase JWT validation.

    Reads from environment variables.  ``SUPABASE_URL`` is canonical for the
    Python backend; ``NEXT_PUBLIC_SUPABASE_URL`` is accepted as a fallback so
    local dev can share a single ``.env.local`` file with the frontend.
    """

    supabase_url: str = Field(
        validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
        description="Supabase project URL, e.g. https://<ref>.supabase.co",
    )
    supabase_jwt_secret: Optional[SecretStr] = Field(
        default=None,
        validation_alias="SUPABASE_JWT_SECRET",
        description="JWT secret — only needed for HS256 local-dev fallback.",
    )
    expected_audience: str = Field(
        default="authenticated",
        description="Expected JWT `aud` claim.  Supabase v2 uses 'authenticated'.",
    )
    cache_ttl_seconds: int = Field(
        default=3600,
        description="How long to cache JWKS keys before re-fetching (seconds).",
    )

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @property
    def jwks_url(self) -> str:
        """JWKS endpoint: ``{supabase_url}/auth/v1/.well-known/jwks.json``."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def expected_issuer(self) -> str:
        """Expected JWT ``iss`` claim: ``{supabase_url}/auth/v1``."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


# ---------------------------------------------------------------------------
# Claims model
# ---------------------------------------------------------------------------


class SupabaseClaims(PydanticBaseModel):
    """Validated payload extracted from a Supabase JWT.

    Fields mirror the standard Supabase JWT structure described at
    https://supabase.com/docs/guides/auth/jwts
    """

    sub: UUID
    email: Optional[EmailStr] = None
    role: Literal["authenticated", "anon", "service_role"]
    aud: str
    exp: int

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# JWKS cache
# ---------------------------------------------------------------------------


class JWKSCache:
    """Async-safe in-memory cache for Supabase JWKS signing keys.

    Keys are refreshed once per ``cache_ttl_seconds`` and on demand when an
    unknown ``kid`` is encountered (handles key rotation transparently).

    Example::

        cache = JWKSCache(jwks_url="https://.../.well-known/jwks.json")
        key = await cache.get_signing_key("my-kid")
    """

    def __init__(self, jwks_url: str, cache_ttl_seconds: int = 3600) -> None:
        self._jwks_url = jwks_url
        self._cache_ttl = cache_ttl_seconds
        self._keys: dict[str, dict[str, Any]] = {}
        self._last_fetch: float = 0.0
        self._lock: asyncio.Lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def get_signing_key(self, kid: str) -> dict[str, Any]:
        """Return the JWK dict for *kid*, refreshing as needed.

        Args:
            kid: The key ID from the JWT header.

        Returns:
            JWK dict suitable for passing to ``jose.jwt.decode()``.

        Raises:
            KeyError: If the key ID is absent even after a forced refresh.
            httpx.HTTPStatusError: If the JWKS endpoint returns an error.
        """
        async with self._lock:
            elapsed = time.monotonic() - self._last_fetch
            cache_stale = elapsed > self._cache_ttl or not self._keys
            if cache_stale:
                await self._refresh()

            if kid not in self._keys:
                # Key absent — may have been rotated since last fetch
                logger.warning(
                    "JWT kid=%r not found in JWKS cache; forcing refresh for key rotation",
                    kid,
                )
                await self._refresh()

            if kid not in self._keys:
                raise KeyError(f"JWT kid={kid!r} not found in JWKS after refresh")

            return self._keys[kid]

    @property
    def is_populated(self) -> bool:
        """True if the cache holds at least one key."""
        return bool(self._keys)

    @property
    def key_count(self) -> int:
        """Number of cached signing keys."""
        return len(self._keys)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _refresh(self) -> None:
        """Fetch fresh JWKS from the remote endpoint (call inside ``_lock``)."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(self._jwks_url)
            response.raise_for_status()
            data: dict[str, Any] = response.json()

        new_keys: dict[str, dict[str, Any]] = {}
        for key_data in data.get("keys", []):
            kid: str = key_data.get("kid", "default")
            new_keys[kid] = key_data

        self._keys = new_keys
        self._last_fetch = time.monotonic()
        logger.info("JWKS refreshed: %d key(s) loaded from %s", len(self._keys), self._jwks_url)


# ---------------------------------------------------------------------------
# Module-level singleton cache — wired up during app lifespan
# ---------------------------------------------------------------------------

_jwks_cache: Optional[JWKSCache] = None


def get_jwks_cache() -> Optional[JWKSCache]:
    """Return the module-level :class:`JWKSCache` instance (may be ``None``)."""
    return _jwks_cache


def init_jwks_cache(settings: SupabaseAuthSettings) -> JWKSCache:
    """Create and register the module-level :class:`JWKSCache`.

    Called once from the FastAPI lifespan handler so the cache is warm
    before the first request arrives.
    """
    global _jwks_cache
    _jwks_cache = JWKSCache(
        jwks_url=settings.jwks_url,
        cache_ttl_seconds=settings.cache_ttl_seconds,
    )
    return _jwks_cache


# ---------------------------------------------------------------------------
# Core verification function
# ---------------------------------------------------------------------------


async def verify_supabase_jwt(
    token: str,
    settings: SupabaseAuthSettings,
    cache: Optional[JWKSCache] = None,
) -> SupabaseClaims:
    """Validate a raw Supabase JWT and return structured claims.

    Algorithm selection:
    - **HS256** header → verified immediately against ``supabase_jwt_secret``
      (typical for ``supabase start`` local dev).
    - **RS256 / ES256 / ...** header → verified via JWKS public key (preferred,
      used by Supabase Cloud and self-hosted with asymmetric keys).
    - If JWKS is unreachable *and* ``supabase_jwt_secret`` is configured, the
      function falls back to HS256 and logs a warning.

    Args:
        token: Raw JWT string — must NOT include the ``Bearer `` prefix.
        settings: :class:`SupabaseAuthSettings` instance.
        cache: :class:`JWKSCache` to use; defaults to the module singleton.

    Returns:
        Validated :class:`SupabaseClaims`.

    Raises:
        :class:`fastapi.HTTPException` (401) on any validation failure.
    """
    if cache is None:
        cache = _jwks_cache

    decode_options: dict[str, bool] = {
        "verify_aud": True,
        "verify_exp": True,
        "verify_iat": True,
        "verify_iss": True,
    }

    # ------------------------------------------------------------------ #
    # 1. Parse the JWT header without signature verification
    # ------------------------------------------------------------------ #
    try:
        unverified_header: dict[str, Any] = jwt.get_unverified_header(token)
    except JWTError:
        _raise_401("Malformed token")

    alg: str = unverified_header.get("alg", "RS256")
    kid: str = unverified_header.get("kid", "default")

    # ------------------------------------------------------------------ #
    # 2. HS256 path (local-dev / self-hosted Supabase with symmetric key) #
    # ------------------------------------------------------------------ #
    if alg == "HS256":
        if settings.supabase_jwt_secret is None:
            _raise_401("HS256 token received but SUPABASE_JWT_SECRET is not configured")
        return _decode_hs256(token, settings, decode_options)

    # ------------------------------------------------------------------ #
    # 3. Asymmetric path (RS256 / ES256 — Supabase Cloud default)         #
    # ------------------------------------------------------------------ #
    if alg not in _ASYMMETRIC_ALGS:
        _raise_401(f"Unsupported JWT algorithm: {alg}")

    jwks_unavailable = False

    if cache is not None:
        signing_key: Optional[dict[str, Any]] = None
        try:
            signing_key = await cache.get_signing_key(kid)
        except KeyError as exc:
            logger.warning("JWKS key not found: %s", exc)
            jwks_unavailable = True
        except httpx.HTTPError as exc:
            logger.warning("JWKS endpoint unreachable: %s: %s", type(exc).__name__, exc)
            jwks_unavailable = True

        if signing_key is not None:
            # Key retrieved — now validate the full token (signature + claims)
            try:
                payload = jwt.decode(
                    token,
                    signing_key,
                    algorithms=[alg],
                    audience=settings.expected_audience,
                    issuer=settings.expected_issuer,
                    options=decode_options,
                )
                return _build_claims(payload)
            except JWTError as exc:
                # The JWT itself is invalid — do NOT fall back to HS256
                logger.warning(
                    "JWT validation failed (sig/claims) — kid=%r alg=%s: %s: %s",
                    kid,
                    alg,
                    type(exc).__name__,
                    exc,
                )
                _raise_401("Invalid or expired token")
    else:
        # Cache is not initialized — treat as JWKS unavailable
        jwks_unavailable = True
        logger.warning("JWKS cache not initialized; cannot verify %s token", alg)

    # ------------------------------------------------------------------ #
    # 4. HS256 fallback — only when JWKS is unreachable, not invalid sig  #
    # ------------------------------------------------------------------ #
    if jwks_unavailable and settings.supabase_jwt_secret is not None:
        logger.warning(
            "JWKS unavailable — falling back to HS256 JWT secret (kid=%r, alg=%s). "
            "This should only occur in local-dev or during a JWKS outage.",
            kid,
            alg,
        )
        return _decode_hs256(token, settings, decode_options)

    _raise_401("Invalid or expired token")


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _decode_hs256(
    token: str,
    settings: SupabaseAuthSettings,
    options: dict[str, bool],
) -> SupabaseClaims:
    """Decode and validate an HS256-signed token using the configured secret."""
    assert settings.supabase_jwt_secret is not None  # noqa: S101 — caller checks
    try:
        secret = settings.supabase_jwt_secret.get_secret_value()
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=settings.expected_audience,
            issuer=settings.expected_issuer,
            options=options,
        )
        return _build_claims(payload)
    except JWTError as exc:
        logger.warning("HS256 JWT validation failed: %s: %s", type(exc).__name__, exc)
        _raise_401("Invalid or expired token")


def _build_claims(payload: dict[str, Any]) -> SupabaseClaims:
    """Parse a raw JWT payload dict into :class:`SupabaseClaims`.

    Raises:
        :class:`fastapi.HTTPException` (401) if the payload is structurally invalid.
    """
    try:
        return SupabaseClaims.model_validate(payload)
    except Exception as exc:
        logger.warning("JWT claims structure invalid: %s", exc)
        _raise_401("Invalid token claims")


def _raise_401(detail: str) -> None:
    """Raise HTTP 401 with ``WWW-Authenticate: Bearer`` header.

    Centralised so callers don't need to construct the response themselves.
    """
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
