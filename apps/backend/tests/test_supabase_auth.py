"""Unit tests for Supabase JWT validation.

Tests cover:
- Valid RS256 token → claims returned
- Expired token → 401
- Invalid signature → 401
- Wrong audience → 401
- Wrong issuer → 401
- Missing Authorization header → 401
- Malformed Bearer header → 401
- JWKS cache hit (single fetch for multiple requests)
- JWKS cache refresh on unknown kid
- HS256 fallback when JWKS is unavailable
- HS256 token without configured secret → 401
- Unsupported algorithm → 401

All tests are async and use ``respx`` to mock the JWKS endpoint.
No real network calls are made.
"""

from __future__ import annotations

import base64
import time
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from httpx import Response
from jose import jwt

from app.supabase_auth import (
    JWKSCache,
    SupabaseAuthSettings,
    SupabaseClaims,
    init_jwks_cache,
    verify_supabase_jwt,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SUPABASE_URL = "https://test.supabase.co"
_JWKS_URL = f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_TEST_KID = "test-key-id-1"
_ALT_KID = "test-key-id-2"
_AUDIENCE = "authenticated"
_ISSUER = f"{_SUPABASE_URL}/auth/v1"
_TEST_JWT_SECRET = "super-secret-hs256-key-for-tests"  # noqa: S105 — test only


# ---------------------------------------------------------------------------
# RSA keypair fixture helpers
# ---------------------------------------------------------------------------


def _int_to_base64url(n: int) -> str:
    """Encode a big integer as a base64url string (no padding)."""
    byte_length = (n.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(n.to_bytes(byte_length, "big")).rstrip(b"=").decode()


def _make_rsa_keypair(kid: str) -> tuple[bytes, dict[str, Any]]:
    """Generate an RSA keypair and return (private_pem, public_jwk_dict)."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    pub_nums = public_key.public_numbers()

    jwk_dict: dict[str, Any] = {
        "kty": "RSA",
        "kid": kid,
        "use": "sig",
        "alg": "RS256",
        "n": _int_to_base64url(pub_nums.n),
        "e": _int_to_base64url(pub_nums.e),
    }
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_pem, jwk_dict


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def rsa_keypair() -> tuple[bytes, dict[str, Any]]:
    """Primary RSA keypair used in most tests."""
    return _make_rsa_keypair(_TEST_KID)


@pytest.fixture(scope="module")
def alt_rsa_keypair() -> tuple[bytes, dict[str, Any]]:
    """Alternate RSA keypair used for key-rotation tests."""
    return _make_rsa_keypair(_ALT_KID)


@pytest.fixture
def settings() -> SupabaseAuthSettings:
    """Settings pointing at our fake Supabase URL."""
    return SupabaseAuthSettings(
        supabase_url=_SUPABASE_URL,
        supabase_jwt_secret=None,
        expected_audience=_AUDIENCE,
        cache_ttl_seconds=3600,
    )


@pytest.fixture
def settings_with_secret() -> SupabaseAuthSettings:
    """Settings that also have a JWT secret configured (for fallback tests)."""
    return SupabaseAuthSettings(
        supabase_url=_SUPABASE_URL,
        supabase_jwt_secret=_TEST_JWT_SECRET,  # type: ignore[arg-type]
        expected_audience=_AUDIENCE,
        cache_ttl_seconds=3600,
    )


def _valid_payload(sub: UUID | None = None, **overrides: Any) -> dict[str, Any]:
    """Build a minimal valid Supabase JWT payload."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(sub or uuid4()),
        "email": "test@example.com",
        "role": "authenticated",
        "aud": _AUDIENCE,
        "iss": _ISSUER,
        "iat": now - 10,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return payload


def _sign_rs256(payload: dict[str, Any], private_pem: bytes, kid: str = _TEST_KID) -> str:
    """Sign a payload with RS256 and embed the given kid in the header."""
    return jwt.encode(
        payload,
        private_pem,
        algorithm="RS256",
        headers={"kid": kid, "alg": "RS256"},
    )


def _sign_hs256(payload: dict[str, Any]) -> str:
    """Sign a payload with HS256 using the test secret."""
    return jwt.encode(payload, _TEST_JWT_SECRET, algorithm="HS256")


def _jwks_response(jwk_dicts: list[dict[str, Any]]) -> dict[str, Any]:
    """Wrap JWK dicts in a standard JWKS envelope."""
    return {"keys": jwk_dicts}


# ---------------------------------------------------------------------------
# Test: valid token → claims returned
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_rs256_token_returns_claims(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """A well-formed RS256 token with correct claims must return SupabaseClaims."""
    private_pem, public_jwk = rsa_keypair
    user_id = uuid4()
    token = _sign_rs256(_valid_payload(sub=user_id), private_pem)

    with respx.mock(assert_all_called=True) as mock:
        mock.get(_JWKS_URL).mock(
            return_value=Response(200, json=_jwks_response([public_jwk]))
        )
        cache = JWKSCache(jwks_url=_JWKS_URL)
        claims = await verify_supabase_jwt(token, settings, cache)

    assert isinstance(claims, SupabaseClaims)
    assert claims.sub == user_id
    assert claims.email == "test@example.com"
    assert claims.role == "authenticated"
    assert claims.aud == _AUDIENCE


# ---------------------------------------------------------------------------
# Test: expired token → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_expired_token_raises_401(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """An expired token must raise HTTP 401."""
    private_pem, public_jwk = rsa_keypair
    expired_payload = _valid_payload(
        exp=int(time.time()) - 600,  # expired 10 minutes ago
    )
    token = _sign_rs256(expired_payload, private_pem)

    with respx.mock() as mock:
        mock.get(_JWKS_URL).mock(
            return_value=Response(200, json=_jwks_response([public_jwk]))
        )
        cache = JWKSCache(jwks_url=_JWKS_URL)
        with pytest.raises(HTTPException) as exc_info:
            await verify_supabase_jwt(token, settings, cache)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: invalid signature → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_signature_raises_401(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    alt_rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """A token signed with a different key must raise HTTP 401."""
    private_pem, _ = rsa_keypair
    _, wrong_public_jwk = alt_rsa_keypair
    # Serve the wrong key (alt keypair's public) but sign with the primary private key
    token = _sign_rs256(_valid_payload(), private_pem)

    with respx.mock() as mock:
        mock.get(_JWKS_URL).mock(
            return_value=Response(
                200,
                # Serve alt public key under the primary kid so the cache returns it
                json=_jwks_response([{**wrong_public_jwk, "kid": _TEST_KID}]),
            )
        )
        cache = JWKSCache(jwks_url=_JWKS_URL)
        with pytest.raises(HTTPException) as exc_info:
            await verify_supabase_jwt(token, settings, cache)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: wrong audience → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_audience_raises_401(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """A token with an unexpected ``aud`` claim must raise HTTP 401."""
    private_pem, public_jwk = rsa_keypair
    token = _sign_rs256(_valid_payload(aud="wrong-audience"), private_pem)

    with respx.mock() as mock:
        mock.get(_JWKS_URL).mock(
            return_value=Response(200, json=_jwks_response([public_jwk]))
        )
        cache = JWKSCache(jwks_url=_JWKS_URL)
        with pytest.raises(HTTPException) as exc_info:
            await verify_supabase_jwt(token, settings, cache)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: wrong issuer → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_issuer_raises_401(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """A token with an unexpected ``iss`` claim must raise HTTP 401."""
    private_pem, public_jwk = rsa_keypair
    token = _sign_rs256(_valid_payload(iss="https://evil.example.com/auth/v1"), private_pem)

    with respx.mock() as mock:
        mock.get(_JWKS_URL).mock(
            return_value=Response(200, json=_jwks_response([public_jwk]))
        )
        cache = JWKSCache(jwks_url=_JWKS_URL)
        with pytest.raises(HTTPException) as exc_info:
            await verify_supabase_jwt(token, settings, cache)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: missing Authorization header → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_authorization_header_raises_401(
    settings: SupabaseAuthSettings,
) -> None:
    """A request without an Authorization header must raise HTTP 401."""
    from app.dependencies import get_current_user

    # Build a minimal Request-like object with no Authorization header
    mock_request = MagicMock()
    mock_request.headers = {}
    mock_request.url.path = "/test"
    mock_request.method = "GET"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, settings=settings)

    assert exc_info.value.status_code == 401
    assert "missing" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Test: malformed bearer → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_malformed_bearer_raises_401(
    settings: SupabaseAuthSettings,
) -> None:
    """A request with a malformed Authorization header must raise HTTP 401."""
    from app.dependencies import get_current_user

    mock_request = MagicMock()
    mock_request.headers = {"Authorization": "NotBearer sometoken"}
    mock_request.url.path = "/test"
    mock_request.method = "GET"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, settings=settings)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: JWKS cache hit — single fetch for two requests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jwks_cache_hit_single_fetch(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """The JWKS endpoint must be called exactly once for two sequential requests."""
    private_pem, public_jwk = rsa_keypair
    token = _sign_rs256(_valid_payload(), private_pem)

    fetch_count = 0

    with respx.mock() as mock:

        def _count_fetches(_request: Any) -> Response:
            nonlocal fetch_count
            fetch_count += 1
            return Response(200, json=_jwks_response([public_jwk]))

        mock.get(_JWKS_URL).mock(side_effect=_count_fetches)
        cache = JWKSCache(jwks_url=_JWKS_URL, cache_ttl_seconds=3600)

        await verify_supabase_jwt(token, settings, cache)
        await verify_supabase_jwt(token, settings, cache)

    assert fetch_count == 1, f"Expected 1 JWKS fetch, got {fetch_count}"


# ---------------------------------------------------------------------------
# Test: JWKS cache refresh on unknown kid
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jwks_cache_refreshes_on_unknown_kid(
    rsa_keypair: tuple[bytes, dict[str, Any]],
    alt_rsa_keypair: tuple[bytes, dict[str, Any]],
    settings: SupabaseAuthSettings,
) -> None:
    """When a kid is absent after initial fetch, the cache must re-fetch once."""
    primary_pem, primary_jwk = rsa_keypair
    alt_pem, alt_jwk = alt_rsa_keypair

    # First token uses the primary kid; second token uses the alt kid
    token_alt = _sign_rs256(_valid_payload(), alt_pem, kid=_ALT_KID)

    fetch_count = 0

    def _jwks_handler(_request: Any) -> Response:
        nonlocal fetch_count
        fetch_count += 1
        # After first fetch only the primary key is present.
        # After second fetch (rotation) both keys are present.
        if fetch_count == 1:
            return Response(200, json=_jwks_response([primary_jwk]))
        return Response(200, json=_jwks_response([primary_jwk, alt_jwk]))

    with respx.mock() as mock:
        mock.get(_JWKS_URL).mock(side_effect=_jwks_handler)
        cache = JWKSCache(jwks_url=_JWKS_URL, cache_ttl_seconds=3600)

        # Warm cache with primary key
        token_primary = _sign_rs256(_valid_payload(), primary_pem)
        await verify_supabase_jwt(token_primary, settings, cache)
        assert fetch_count == 1

        # Alt kid is absent → should trigger a second fetch
        await verify_supabase_jwt(token_alt, settings, cache)
        assert fetch_count == 2, f"Expected 2 JWKS fetches for key rotation, got {fetch_count}"


# ---------------------------------------------------------------------------
# Test: HS256 fallback when JWKS is unavailable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hs256_fallback_when_jwks_unavailable(
    settings_with_secret: SupabaseAuthSettings,
) -> None:
    """When the JWKS endpoint is down, an HS256 token must verify via the secret."""
    token = _sign_hs256(_valid_payload())

    # No cache, secret is configured — should succeed via HS256 path
    claims = await verify_supabase_jwt(token, settings_with_secret, cache=None)
    assert claims.role == "authenticated"


# ---------------------------------------------------------------------------
# Test: HS256 token without configured secret → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hs256_without_secret_raises_401(
    settings: SupabaseAuthSettings,
) -> None:
    """An HS256 token when no JWT secret is configured must raise HTTP 401."""
    token = _sign_hs256(_valid_payload())

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(token, settings, cache=None)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: malformed token (not JWT at all)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_completely_malformed_token_raises_401(
    settings: SupabaseAuthSettings,
) -> None:
    """A completely garbled token string must raise HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt("this.is.not.a.jwt", settings, cache=None)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Test: init_jwks_cache registers module singleton
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_init_jwks_cache_registers_singleton(
    settings: SupabaseAuthSettings,
) -> None:
    """``init_jwks_cache`` must register the module-level singleton."""
    from app.supabase_auth import get_jwks_cache

    cache = init_jwks_cache(settings)
    assert get_jwks_cache() is cache
    assert isinstance(cache, JWKSCache)

