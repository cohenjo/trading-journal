"""Credit-card expenses inbox scanner — periodic job.

Scans ``reports/credit-card/inbox/`` every 60 seconds, ingests new PDFs:

1. SHA-256 dedup (``file_hash`` check against ``expense_inbox`` table).
2. Insert ``expense_inbox`` row (status=processing).
3. ``dispatch_pdf()`` → ``ParsedStatement``
   (includes 30 s thread-safe timeout + 5 MB file cap + 500 KB text cap).
4. Build ``CreditCardStatement`` + ``CreditCardTransaction`` rows.
5. ``CategoryResolver.resolve()`` for each transaction.
6. INSERT into ``credit_card_statements`` + ``credit_card_transactions``.
7. UPDATE ``expense_inbox`` row (status=completed, processed_at=now()).
8. Move inbox file → ``/processed/`` (or ``/errors/`` on failure).

Failure handling:
    Typed exceptions from the dispatcher (``ParserError`` subclasses) are
    caught; ``expense_inbox.status`` is set to ``'errored'``,
    ``error_message`` is populated, ``retry_count`` increments, and the file
    is moved to ``/errors/`` with an ``.error.txt`` sidecar.

    When ``retry_count >= _MAX_RETRY``, the file stays in ``/errors/`` and is
    **not** requeued automatically.  The operator may move it back to
    ``/inbox/`` manually to retry.

Retry policy (v1):
    - All failures move the file to ``/errors/`` (secure, 0600 perms).
    - ``retry_count`` is incremented on every failure including orphaned
      'processing' rows left by a crashed worker.
    - When ``retry_count >= _MAX_RETRY`` (3) the file is left in ``/errors/``
      permanently and skipped on subsequent scans.

Concurrency:
    A module-level ``threading.Lock`` prevents two APScheduler ticks from
    running ``scan_inbox_once`` concurrently within the same process.

    TODO(future): If the worker ever scales to multiple instances this
    in-process lock will race.  Replace with a distributed advisory lock
    (Postgres ``pg_try_advisory_lock`` or Redis SETNX) before scaling out.

Watchdog note:
    60 s polling is simpler and consistent with the existing worker patterns.
    ``watchdog``/inotify could replace it for sub-second detection if latency
    ever becomes a requirement; no code changes needed outside this function.

Volume mount (Docker):
    Expects volume mount at ``/app/reports/credit-card/inbox`` in Docker;
    defaults to ``./reports/credit-card/inbox`` locally.
    Override via the ``CREDIT_CARD_INBOX_DIR`` environment variable.

Environment variables:
    CREDIT_CARD_INBOX_DIR
        Absolute path to the inbox directory.
        Default: ``reports/credit-card/inbox`` (relative to cwd).
    CREDIT_CARD_INBOX_ENABLED
        Set to ``"false"`` / ``"0"`` to disable job registration at startup.
        Default: enabled.
    CREDIT_CARD_DEFAULT_HOUSEHOLD_ID
        UUID string of the household to use when processing PDFs.
        If unset the worker queries the DB and picks the single household
        (or the first alphabetically if multiple exist).

Authored by Hockney (CC-5).  Triggers worker redeploy gate (CC-11/Kujan).
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Session, select

from app.dal.database import engine
from app.schema.expenses import (
    CreditCardStatement,
    CreditCardTransaction,
    ExpenseInbox,
)
from app.schema.household_models import Household
from app.services.expenses.categorize import CategoryResolver
from app.services.expenses.parsers.dispatcher import dispatch_pdf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Directory configuration
# ---------------------------------------------------------------------------

# Expects volume mount at /app/reports/credit-card/inbox in Docker;
# defaults to ./reports/credit-card/inbox locally.
INBOX_DIR: Path = Path(os.getenv("CREDIT_CARD_INBOX_DIR", "reports/credit-card/inbox")).resolve()
PROCESSED_DIR: Path = INBOX_DIR.parent / "processed"
ERRORS_DIR: Path = INBOX_DIR.parent / "errors"

_MAX_RETRY: int = 3
_BACKPRESSURE_WARN_THRESHOLD: int = 50

# In-process lock: prevents two APScheduler ticks from running scan_inbox_once
# concurrently within the same worker process.
_scan_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Session factory type
# ---------------------------------------------------------------------------

SessionFactory = Callable[[], AbstractContextManager[Session]]


@contextmanager
def _default_session():
    """Default session factory — uses the production engine."""
    with Session(engine) as db:
        yield db


# ---------------------------------------------------------------------------
# Household resolution (module-level cache — resolved once per process)
# ---------------------------------------------------------------------------

_DEFAULT_HOUSEHOLD_ID: Optional[UUID] = None


def _resolve_household_id(db: Session) -> Optional[UUID]:
    """Resolve the default ``household_id`` for the worker process.

    Resolution order:

    1. ``CREDIT_CARD_DEFAULT_HOUSEHOLD_ID`` env var (explicit operator config).
    2. Single household in the DB (Jony's household for single-user setup).
    3. Multiple households: log WARNING, pick first alphabetically by ``id``.

    Returns ``None`` if the DB is empty — the caller should skip the scan
    cycle and log an error.

    v1 limitation: single-household worker.  Multi-household support
    (per-file routing or cardholder-based dispatch) is deferred to a future
    task.
    """
    global _DEFAULT_HOUSEHOLD_ID
    if _DEFAULT_HOUSEHOLD_ID is not None:
        return _DEFAULT_HOUSEHOLD_ID

    env_id = os.getenv("CREDIT_CARD_DEFAULT_HOUSEHOLD_ID")
    if env_id:
        try:
            _DEFAULT_HOUSEHOLD_ID = UUID(env_id)
            logger.info(
                "expenses_inbox: household_id resolved from env: %s",
                _DEFAULT_HOUSEHOLD_ID,
            )
            return _DEFAULT_HOUSEHOLD_ID
        except ValueError:
            logger.error(
                "expenses_inbox: invalid CREDIT_CARD_DEFAULT_HOUSEHOLD_ID=%r; falling back to DB lookup",
                env_id,
            )

    rows = db.exec(select(Household)).all()
    if not rows:
        logger.error(
            "expenses_inbox: no households in DB; skipping scan cycle. "
            "Ensure at least one household exists or set "
            "CREDIT_CARD_DEFAULT_HOUSEHOLD_ID."
        )
        return None

    if len(rows) > 1:
        logger.warning(
            "expenses_inbox: %d households found; using first by id. "
            "Set CREDIT_CARD_DEFAULT_HOUSEHOLD_ID to be explicit.",
            len(rows),
        )

    rows_sorted = sorted(rows, key=lambda h: str(h.id))
    _DEFAULT_HOUSEHOLD_ID = rows_sorted[0].id
    logger.info(
        "expenses_inbox: household_id resolved from DB: %s",
        _DEFAULT_HOUSEHOLD_ID,
    )
    return _DEFAULT_HOUSEHOLD_ID


# ---------------------------------------------------------------------------
# Security helpers (Rabin CC-5 conditions)
# ---------------------------------------------------------------------------


def _sanitize_filename(filename: str) -> str:
    """Strip all directory components — path-traversal defence.

    Implements Rabin CC-5 security condition §1.3 (path traversal via filename).
    ``os.path.basename`` is used rather than string manipulation so that both
    POSIX and Windows path separators are handled correctly.

    Examples::

        '../../etc/passwd.pdf' → 'passwd.pdf'
        'statement.pdf'        → 'statement.pdf'
        ''                     → 'unnamed.pdf'
    """
    return os.path.basename(filename) or "unnamed.pdf"


def _sha256_file(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65_536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Directory setup
# ---------------------------------------------------------------------------


def _ensure_dirs() -> None:
    """Create inbox/processed/errors directories and set 0700 permissions.

    Implements Rabin CC-5 security condition §2.1: directories restricted to
    the worker process only (``rwx------``).
    """
    for d in (INBOX_DIR, PROCESSED_DIR, ERRORS_DIR):
        d.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError as exc:
            logger.warning("expenses_inbox: could not chmod %s to 0700: %s", d, exc)


# ---------------------------------------------------------------------------
# Error-file helpers
# ---------------------------------------------------------------------------


def _move_to_errors(pdf_path: Path, safe_name: str, error_msg: str) -> None:
    """Move *pdf_path* to ``ERRORS_DIR`` and write an ``.error.txt`` sidecar.

    Rabin CC-5 §2.2: processed/error files set to 0600 (``rw-------``).
    Uses ``shutil.move`` instead of ``Path.rename`` so cross-device moves work.
    """
    ERRORS_DIR.mkdir(parents=True, exist_ok=True)
    dest = ERRORS_DIR / safe_name

    try:
        shutil.move(str(pdf_path), str(dest))
        os.chmod(dest, 0o600)
    except OSError as exc:
        logger.warning("expenses_inbox: could not move %r to errors/: %s", safe_name, exc)

    sidecar = ERRORS_DIR / (safe_name + ".error.txt")
    try:
        sidecar.write_text(error_msg, encoding="utf-8")
        os.chmod(sidecar, 0o600)
    except OSError as exc:
        logger.warning(
            "expenses_inbox: could not write error sidecar for %r: %s",
            safe_name,
            exc,
        )


# ---------------------------------------------------------------------------
# Orphaned row recovery
# ---------------------------------------------------------------------------


def _reset_orphaned_processing_rows(db: Session) -> int:
    """Reset ``status='processing'`` rows to ``'errored'`` and increment retry_count.

    Called at the start of every ``scan_inbox_once`` pass.  Rows left in
    ``'processing'`` status indicate that the worker process crashed (or was
    killed) while a PDF was mid-transaction.  Resetting them to ``'errored'``
    allows the next scan to retry the file when it is found in the inbox.

    Returns the number of rows reset.
    """
    orphaned = db.exec(select(ExpenseInbox).where(ExpenseInbox.status == "processing")).all()

    if not orphaned:
        return 0

    for row in orphaned:
        row.status = "errored"
        row.error_message = "Worker restarted while processing this file; queued for retry."
        row.retry_count = (row.retry_count or 0) + 1
        db.add(row)

    db.commit()
    logger.debug(
        "expenses_inbox: reset %d orphaned processing row(s) to errored",
        len(orphaned),
    )
    return len(orphaned)


# ---------------------------------------------------------------------------
# Per-PDF processing
# ---------------------------------------------------------------------------


def process_one_pdf(
    pdf_path: Path,
    db: Session,
    household_id: UUID,
    resolver: Optional[CategoryResolver] = None,
) -> str:
    """Process one PDF end-to-end and return the terminal status string.

    Parameters
    ----------
    pdf_path:     Absolute path to the PDF file in the inbox directory.
    db:           Active SQLModel session.  All DB writes per PDF are
                  committed atomically (partial statements never persist).
    household_id: UUID of the target household.
    resolver:     ``CategoryResolver`` instance.  Pass a shared instance from
                  the scan loop to avoid reloading 100+ regexes per PDF.

    Returns
    -------
    ``'completed'`` | ``'duplicate'`` | ``'errored'``

    Security (Rabin CC-5):
    - ``_sanitize_filename()`` strips any directory components before any
      filesystem operation (path-traversal defence).
    - ``dispatch_pdf()`` enforces 30 s thread-safe timeout, 5 MB file cap,
      and 500 KB extracted-text cap.
    - Processed/error files are set to ``0600``.
    """
    if resolver is None:
        resolver = CategoryResolver()

    # Security: basename-only name for all filesystem operations.
    safe_name = _sanitize_filename(pdf_path.name)
    file_hash = _sha256_file(pdf_path)
    file_size = pdf_path.stat().st_size

    # ── Dedup: already-completed row with same hash? ─────────────────────
    already_done = db.exec(
        select(ExpenseInbox).where(
            ExpenseInbox.file_hash == file_hash,
            ExpenseInbox.status == "completed",
        )
    ).first()

    if already_done is not None:
        dup = ExpenseInbox(
            id=uuid4(),
            file_path=safe_name,
            file_hash=file_hash,
            file_size_bytes=file_size,
            status="duplicate",
            household_id=household_id,
            submitted_at=datetime.utcnow(),
        )
        db.add(dup)
        db.commit()
        logger.debug(
            "expenses_inbox: duplicate %r (hash=%s…) — skipped",
            safe_name,
            file_hash[:8],
        )
        return "duplicate"

    # ── Check existing errored row (retry logic) ─────────────────────────
    errored_row = db.exec(
        select(ExpenseInbox).where(
            ExpenseInbox.file_hash == file_hash,
            ExpenseInbox.status == "errored",
        )
    ).first()

    if errored_row is not None and (errored_row.retry_count or 0) >= _MAX_RETRY:
        # Max retries reached — move to /errors/ and leave it there.
        _move_to_errors(pdf_path, safe_name, "Max retry limit reached")
        logger.debug(
            "expenses_inbox: %r hit max retries (%d) — moved to errors/ permanently",
            safe_name,
            _MAX_RETRY,
        )
        return "errored"

    # ── Phase 1: commit inbox row (durable before any parsing begins) ─────
    if errored_row is not None:
        # Retry path: reuse existing row; retry_count incremented on failure.
        inbox_id: UUID = errored_row.id
        errored_row.status = "processing"
        errored_row.error_message = None
        db.add(errored_row)
    else:
        new_row = ExpenseInbox(
            id=uuid4(),
            file_path=safe_name,
            file_hash=file_hash,
            file_size_bytes=file_size,
            status="processing",
            retry_count=0,
            household_id=household_id,
            submitted_at=datetime.utcnow(),
        )
        db.add(new_row)
        inbox_id = new_row.id

    db.commit()  # Phase 1 commit — inbox row now durable

    # ── Phase 2: parse → categorise → persist (single atomic transaction) ─
    try:
        # dispatch_pdf() enforces 30 s thread-safe timeout + size caps (Rabin CC-5 §1.1).
        parsed = dispatch_pdf(str(pdf_path))

        stmt = CreditCardStatement(
            id=uuid4(),
            inbox_id=inbox_id,
            file_hash=file_hash,
            source_file_path=safe_name,
            issuer=parsed.issuer,
            # TODO(future): FK to household_members when that table exists.
            cardholder_name=parsed.cardholder_name,
            card_last4=parsed.card_last4,
            period_from=datetime.combine(parsed.period_from, datetime.min.time()),
            period_to=datetime.combine(parsed.period_to, datetime.min.time()),
            total_amount_ils=parsed.total_amount_ils,
            txn_count=len(parsed.transactions),
            parse_warnings=parsed.parse_warnings or None,
            household_id=household_id,
            ingested_at=datetime.utcnow(),
        )
        db.add(stmt)
        db.flush()  # Materialise stmt.id without committing yet.

        for txn in parsed.transactions:
            assignment = resolver.resolve(txn, db, household_id)
            cc_txn = CreditCardTransaction(
                id=uuid4(),
                statement_id=stmt.id,
                txn_date=datetime.combine(txn.txn_date, datetime.min.time()),
                posting_date=(datetime.combine(txn.posting_date, datetime.min.time()) if txn.posting_date else None),
                merchant_raw=txn.merchant_raw,
                merchant_normalized=txn.merchant_normalized,
                amount_ils=txn.amount_ils,
                amount_original=txn.amount_original,
                original_currency=txn.original_currency,
                fx_rate=txn.fx_rate,
                installment_num=txn.installment_num,
                installment_total=txn.installment_total,
                sector_raw=txn.sector_raw,
                category_id=assignment.category_id,
                subcategory_id=assignment.subcategory_id,
                resolution_status=assignment.resolution_status,
                resolution_source=assignment.resolution_source,
                household_id=household_id,
            )
            db.add(cc_txn)

        # Mark inbox row completed and commit everything atomically.
        inbox_row = db.exec(select(ExpenseInbox).where(ExpenseInbox.id == inbox_id)).one()
        inbox_row.status = "completed"
        inbox_row.processed_at = datetime.utcnow()
        db.add(inbox_row)
        db.commit()  # Phase 2 atomic commit

        # Move to /processed/ — Rabin §2.2: file permissions 0600.
        PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        dest = PROCESSED_DIR / safe_name
        shutil.move(str(pdf_path), str(dest))
        try:
            os.chmod(dest, 0o600)
        except OSError:
            pass

        logger.debug(
            "expenses_inbox: completed %r — issuer=%s txns=%d",
            safe_name,
            parsed.issuer,
            len(parsed.transactions),
        )
        return "completed"

    except Exception as exc:
        db.rollback()

        # Re-query inbox row (phase-1 commit survived the rollback).
        inbox_row = db.exec(select(ExpenseInbox).where(ExpenseInbox.id == inbox_id)).first()
        if inbox_row is not None:
            inbox_row.status = "errored"
            inbox_row.error_message = str(exc)[:1024]
            inbox_row.retry_count = (inbox_row.retry_count or 0) + 1
            db.add(inbox_row)
            db.commit()

        _move_to_errors(pdf_path, safe_name, str(exc))

        logger.debug(
            "expenses_inbox: errored %r retry=%d exc=%s",
            safe_name,
            inbox_row.retry_count if inbox_row else 1,
            type(exc).__name__,
        )
        return "errored"


# ---------------------------------------------------------------------------
# Main scan function (registered as APScheduler job)
# ---------------------------------------------------------------------------


def scan_inbox_once(
    session_factory: SessionFactory | None = None,
    household_id: UUID | None = None,
) -> dict[str, int]:
    """Idempotent single-pass scan of ``INBOX_DIR``.

    Registered as APScheduler interval job ``expenses_inbox_scan`` (60 s).
    The scheduler calls this as a zero-argument callable; the optional
    parameters exist for dependency injection in tests.

    Returns a dict with scan counts::

        {'scanned': N, 'completed': M, 'deduped': K, 'errored': L}

    The single INFO log line emitted at the end contains only counts — no
    merchant names, file content, or transaction details at INFO level
    (Rabin CC-5 §3.1 PII condition).  Transaction-level details are at
    DEBUG only.
    """
    if not _scan_lock.acquire(blocking=False):
        logger.debug("expenses_inbox: previous scan still running; skipping this tick")
        return {"scanned": 0, "completed": 0, "deduped": 0, "errored": 0}

    counts: dict[str, int] = {
        "scanned": 0,
        "completed": 0,
        "deduped": 0,
        "errored": 0,
    }

    try:
        _ensure_dirs()

        sf: SessionFactory = session_factory or _default_session

        # Resolve household_id once per cycle.
        with sf() as db:
            hh_id: Optional[UUID] = household_id or _resolve_household_id(db)

        if hh_id is None:
            logger.error("expenses_inbox_scan: could not resolve household_id; skipping scan cycle")
            return counts

        # Reset orphaned 'processing' rows from a previous worker crash.
        with sf() as db:
            _reset_orphaned_processing_rows(db)

        # Collect PDF files in inbox (sorted for deterministic ordering).
        pdf_files = sorted(f for f in INBOX_DIR.iterdir() if f.is_file() and f.suffix.lower() == ".pdf")

        counts["scanned"] = len(pdf_files)

        if len(pdf_files) > _BACKPRESSURE_WARN_THRESHOLD:
            logger.warning(
                "expenses_inbox: %d PDFs waiting in inbox (threshold=%d); consider investigation or manual triage",
                len(pdf_files),
                _BACKPRESSURE_WARN_THRESHOLD,
            )

        # Shared resolver — avoids reloading 100+ regexes per PDF.
        resolver = CategoryResolver()

        for pdf_path in pdf_files:
            with sf() as db:
                status = process_one_pdf(pdf_path, db, hh_id, resolver)

            if status == "completed":
                counts["completed"] += 1
            elif status == "duplicate":
                counts["deduped"] += 1
            elif status == "errored":
                counts["errored"] += 1

    finally:
        _scan_lock.release()

    logger.info(
        "expenses_inbox_scan: scanned=%d completed=%d deduped=%d errored=%d",
        counts["scanned"],
        counts["completed"],
        counts["deduped"],
        counts["errored"],
    )
    return counts
