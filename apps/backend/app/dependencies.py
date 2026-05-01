"""FastAPI dependency providers for Supabase JWT authentication.

Provides ready-to-use ``Depends(...)`` callables for protected endpoints::

    from app.dependencies import get_current_user, get_current_user_id, require_role

    @router.get("/trades")
    async def list_trades(user_id: UUID = Depends(get_current_user_id)):
        ...

    @router.delete("/admin/reset")
    async def admin_reset(
        _: SupabaseClaims = Depends(require_role("service_role"))
    ):
        ...

The existing ``app/auth/dependencies.py`` (local-user JWT system) is left
untouched.  Once the Supabase cutover is complete, that module will be retired
in a separate ticket.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status

from app.supabase_auth import (
    JWKSCache,
    SupabaseAuthSettings,
    SupabaseClaims,
    get_jwks_cache,
    verify_supabase_jwt,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Settings singleton (cached for process lifetime)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _get_settings() -> SupabaseAuthSettings:
    """Return a cached :class:`SupabaseAuthSettings` instance."""
    return SupabaseAuthSettings()


# ---------------------------------------------------------------------------
# Core dependency: extract + validate bearer token
# ---------------------------------------------------------------------------


async def get_current_user(
    request: Request,
    settings: SupabaseAuthSettings = Depends(_get_settings),
) -> SupabaseClaims:
    """FastAPI dependency that validates the ``Authorization: Bearer`` token.

    Extracts the JWT from the ``Authorization`` header, delegates to
    :func:`~app.supabase_auth.verify_supabase_jwt`, and returns the validated
    :class:`~app.supabase_auth.SupabaseClaims`.

    Raises:
        :class:`fastapi.HTTPException` (401) on any auth failure.
    """
    auth_header: str | None = request.headers.get("Authorization")
    if not auth_header:
        logger.warning(
            "Missing Authorization header — path=%s method=%s",
            request.url.path,
            request.method,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = auth_header.split(" ", maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning(
            "Malformed Authorization header — path=%s", request.url.path
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token is empty",
            headers={"WWW-Authenticate": "Bearer"},
        )

    cache: JWKSCache | None = get_jwks_cache()
    return await verify_supabase_jwt(token, settings, cache)


# ---------------------------------------------------------------------------
# Convenience: extract just the user UUID (most common case)
# ---------------------------------------------------------------------------


async def get_current_user_id(
    claims: SupabaseClaims = Depends(get_current_user),
) -> UUID:
    """Convenience dependency returning only the authenticated user's UUID.

    Equivalent to ``Depends(get_current_user)`` followed by ``.sub``.

    Example::

        @router.get("/me/trades")
        async def my_trades(user_id: UUID = Depends(get_current_user_id)):
            return await Trade.for_user(user_id)
    """
    return claims.sub


# ---------------------------------------------------------------------------
# Optional authentication (for telemetry and other public-ish endpoints)
# ---------------------------------------------------------------------------


async def get_current_user_optional(
    request: Request,
    settings: SupabaseAuthSettings = Depends(_get_settings),
) -> SupabaseClaims | None:
    """FastAPI dependency that validates auth if present, returns None if absent.

    Use this for endpoints that gracefully degrade when anonymous, such as
    telemetry that logs user_id when available but still accepts anonymous calls.

    Returns:
        Validated :class:`~app.supabase_auth.SupabaseClaims` if bearer token
        is present and valid, ``None`` otherwise.

    Example::

        @router.post("/api/metrics/page-load")
        async def page_load_metrics(
            claims: SupabaseClaims | None = Depends(get_current_user_optional),
            payload: PageLoadPayload,
        ):
            user_id = claims.sub if claims else None
            log_metric(payload, user_id=user_id)
    """
    auth_header: str | None = request.headers.get("Authorization")
    if not auth_header:
        return None

    parts = auth_header.split(" ", maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.debug(
            "Malformed Authorization header in optional context — path=%s",
            request.url.path,
        )
        return None

    token = parts[1].strip()
    if not token:
        return None

    cache: JWKSCache | None = get_jwks_cache()
    try:
        return await verify_supabase_jwt(token, settings, cache)
    except HTTPException:
        # Token invalid/expired — degrade to anonymous
        logger.debug(
            "Invalid token in optional auth context — path=%s", request.url.path
        )
        return None


# ---------------------------------------------------------------------------
# Role-based access control
# ---------------------------------------------------------------------------


def require_role(role: str) -> Callable[..., SupabaseClaims]:
    """Dependency factory that restricts access to a specific Supabase role.

    Args:
        role: One of ``"authenticated"``, ``"anon"``, or ``"service_role"``.

    Returns:
        A FastAPI dependency callable.  Raises 403 if the caller's role does
        not match.

    Example::

        @router.post("/admin/seed")
        async def seed_data(
            claims: SupabaseClaims = Depends(require_role("service_role"))
        ):
            ...
    """

    async def _role_guard(
        claims: SupabaseClaims = Depends(get_current_user),
    ) -> SupabaseClaims:
        if claims.role != role:
            logger.warning(
                "Role check failed — required=%r actual=%r sub=%s",
                role,
                claims.role,
                claims.sub,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' required",
            )
        return claims

    return _role_guard
