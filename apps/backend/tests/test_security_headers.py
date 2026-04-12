import pytest
from fastapi.testclient import TestClient
from main import app

from app.middleware.security_headers import SECURITY_HEADERS


@pytest.fixture
def client():
    return TestClient(app)


class TestSecurityHeaders:
    """Verify that every response includes the required security headers."""

    def test_root_endpoint_has_all_security_headers(self, client: TestClient):
        response = client.get("/")
        for header, expected in SECURITY_HEADERS.items():
            assert header in response.headers, f"Missing header: {header}"
            assert response.headers[header] == expected, (
                f"{header}: expected '{expected}', got '{response.headers[header]}'"
            )

    def test_headers_present_on_404(self, client: TestClient):
        """Security headers must appear even on error responses."""
        response = client.get("/nonexistent-path")
        for header, expected in SECURITY_HEADERS.items():
            assert response.headers.get(header) == expected

    @pytest.mark.parametrize(
        "header,expected",
        list(SECURITY_HEADERS.items()),
        ids=list(SECURITY_HEADERS.keys()),
    )
    def test_individual_header_value(
        self, client: TestClient, header: str, expected: str
    ):
        response = client.get("/")
        assert response.headers.get(header) == expected
