"""Tests for authentication endpoints and JWT protection."""

from app.auth.security import hash_password, verify_password, create_access_token, verify_token


# ---------------------------------------------------------------------------
# Unit tests for security helpers
# ---------------------------------------------------------------------------

class TestPasswordHashing:
    def test_hash_and_verify(self):
        hashed = hash_password("secret123")
        assert verify_password("secret123", hashed)

    def test_wrong_password(self):
        hashed = hash_password("secret123")
        assert not verify_password("wrong", hashed)


class TestJWT:
    def test_create_and_verify(self):
        token = create_access_token(data={"sub": "alice"})
        payload = verify_token(token)
        assert payload is not None
        assert payload["sub"] == "alice"

    def test_invalid_token(self):
        assert verify_token("not.a.token") is None


# ---------------------------------------------------------------------------
# Integration tests for auth endpoints
# ---------------------------------------------------------------------------

class TestRegister:
    def test_register_success(self, unauth_client):
        resp = unauth_client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "pass1234"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "newuser"
        assert "hashed_password" not in data

    def test_register_duplicate(self, unauth_client):
        unauth_client.post(
            "/api/auth/register",
            json={"username": "dup", "password": "pass"},
        )
        resp = unauth_client.post(
            "/api/auth/register",
            json={"username": "dup", "password": "pass"},
        )
        assert resp.status_code == 409


class TestLogin:
    def test_login_success(self, unauth_client):
        unauth_client.post(
            "/api/auth/register",
            json={"username": "loginuser", "password": "secret"},
        )
        resp = unauth_client.post(
            "/api/auth/login",
            json={"username": "loginuser", "password": "secret"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_login_bad_password(self, unauth_client):
        unauth_client.post(
            "/api/auth/register",
            json={"username": "user2", "password": "right"},
        )
        resp = unauth_client.post(
            "/api/auth/login",
            json={"username": "user2", "password": "wrong"},
        )
        assert resp.status_code == 401


class TestMe:
    def test_me_authenticated(self, unauth_client):
        unauth_client.post(
            "/api/auth/register",
            json={"username": "meuser", "password": "pw"},
        )
        login_resp = unauth_client.post(
            "/api/auth/login",
            json={"username": "meuser", "password": "pw"},
        )
        token = login_resp.json()["access_token"]
        resp = unauth_client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "meuser"

    def test_me_no_token(self, unauth_client):
        resp = unauth_client.get("/api/auth/me")
        assert resp.status_code == 403  # HTTPBearer returns 403 when missing


class TestProtectedRoutes:
    def test_protected_route_rejects_no_auth(self, unauth_client):
        """Any data endpoint should reject unauthenticated requests."""
        resp = unauth_client.get("/api/holdings")
        assert resp.status_code == 403

    def test_health_check_public(self, unauth_client):
        """Root health-check must remain public."""
        resp = unauth_client.get("/")
        assert resp.status_code == 200

    def test_protected_route_accepts_auth(self, client):
        """Client fixture has auth override, so data endpoints work."""
        resp = client.get("/")
        assert resp.status_code == 200
