"""Worker handler for Supabase Storage pension PDF parse jobs."""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import UUID

from sqlmodel import Session

from app.api.pension import apply_pension_analysis_result
from app.dal.database import engine
from app.utils.copilot_analyzer import analyze_report

PENSION_UPLOAD_BUCKET = "pension-uploads"
MAX_PENSION_PDF_BYTES = 10 * 1024 * 1024

JobPayload = dict[str, object]
JobResult = dict[str, object]
Downloader = Callable[[str, UUID], Path]
SessionFactory = Callable[[], AbstractContextManager[Session]]


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session."""

    return Session(engine)


def _sanitize_filename(filename: str) -> str:
    """Return a storage-safe local filename."""

    safe = "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in filename)
    return safe.strip(".-") or "pension-report.pdf"


def _require_payload_string(payload: JobPayload, key: str) -> str:
    """Read a required string field from the job payload."""

    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"pension_pdf_parse payload requires '{key}'")
    return value.strip()


def _storage_object_url(storage_path: str) -> str:
    """Build the Supabase Storage object URL for a private object."""

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL is required to download pension PDFs")
    encoded_path = quote(storage_path, safe="/")
    return f"{supabase_url.rstrip('/')}/storage/v1/object/{PENSION_UPLOAD_BUCKET}/{encoded_path}"


def download_pension_pdf(storage_path: str, household_id: UUID) -> Path:
    """Download a private pension PDF from Supabase Storage with the service role key."""

    if not storage_path.startswith(f"{household_id}/"):
        raise ValueError("storage_path must be scoped under the payload household_id")

    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required to download pension PDFs")

    request = Request(
        _storage_object_url(storage_path),
        headers={"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key},
    )
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - URL is server configured Supabase.
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_PENSION_PDF_BYTES:
                raise ValueError("Pension PDF exceeds the 10MB worker limit")
            data = response.read(MAX_PENSION_PDF_BYTES + 1)
    except HTTPError as exc:
        raise RuntimeError(f"Failed to download pension PDF from Storage: HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to download pension PDF from Storage: {exc.reason}") from exc

    if len(data) > MAX_PENSION_PDF_BYTES:
        raise ValueError("Pension PDF exceeds the 10MB worker limit")
    if not data.startswith(b"%PDF"):
        raise ValueError("Storage object is not a PDF file")

    root_dir = Path(__file__).resolve().parents[4]
    download_dir = root_dir / "reports" / "_worker" / str(household_id)
    download_dir.mkdir(parents=True, exist_ok=True)
    local_path = download_dir / _sanitize_filename(Path(storage_path).name)
    local_path.write_bytes(data)
    return local_path


def _run_analyzer(analyzer: Callable[[str], Any], file_path: Path) -> dict[str, Any]:
    """Run either a sync or async PDF analyzer."""

    analyzed = analyzer(str(file_path))
    if inspect.isawaitable(analyzed):
        analyzed = asyncio.run(analyzed)
    if not isinstance(analyzed, dict):
        raise ValueError("Pension PDF analyzer returned a non-object result")
    return analyzed


def handle_pension_pdf_parse(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
    downloader: Downloader | None = None,
    analyzer: Callable[[str], Any] | None = None,
) -> JobResult:
    """Parse a pension PDF from Storage and persist extracted pension rows."""

    household_id = UUID(_require_payload_string(payload, "household_id"))
    storage_path = _require_payload_string(payload, "storage_path")
    owner = str(payload.get("owner") or "You").strip() or "You"
    filename = str(payload.get("filename") or Path(storage_path).name)

    active_downloader = downloader or download_pension_pdf
    local_path = active_downloader(storage_path, household_id)
    try:
        result = _run_analyzer(analyzer or analyze_report, local_path)
        with (session_factory or _default_session_factory)() as db:
            return apply_pension_analysis_result(db, household_id, owner, result, filename)
    finally:
        if downloader is None and local_path.exists():
            local_path.unlink()
