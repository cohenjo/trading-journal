"""PDF dispatcher: open a credit-card PDF, fingerprint it, and route to the
correct parser.

Security conditions from Rabin CC-2 review:
- File size limit: 5 MB (PDFTooLarge raised before opening)
- Text size limit: 500 KB (PDFTooLarge raised after extraction)
- Timeout: 30 s via ThreadPoolExecutor future (ParserTimeout raised on timeout)
- Full card-number scrub enforced inside each parser (SecurityError)

Thread-safety note (CC-11 follow-up):
  The original SIGALRM approach only works in the main thread of the main
  interpreter. APScheduler runs jobs in a worker thread pool, causing
  "signal only works in main thread" errors.  We now use
  concurrent.futures.ThreadPoolExecutor with Future.result(timeout=...) which
  is thread-safe.

  Cancellation caveat: cancelling a Future that wraps synchronous pdfplumber
  code is best-effort — on timeout we call ``executor.shutdown(wait=False)``
  so the caller is not blocked, but the background thread continues until
  pdfplumber yields (or the worker process exits). Zombie parse threads are
  rare and bounded (one per timed-out PDF), so this is acceptable. If true
  hard-kill isolation is ever required, switch to subprocess-based isolation
  (e.g. pebble.ProcessPool).
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

import pdfplumber

from .base import (
    ParsedStatement,
    ParserError,
    ParserTimeout,
    PDFTooLarge,
    UnknownIssuer,
)
from .cal import CalParser
from .cal_paybox import CalPayBoxParser
from .fingerprint import detect_issuer
from .isracard import IsracardParser
from .max import MaxParser

logger = logging.getLogger(__name__)

_MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
_MAX_TEXT_BYTES = 500_000  # 500 KB
_TIMEOUT_SECONDS = 30

_PARSER_MAP = {
    "cal": CalParser,
    "cal_paybox": CalPayBoxParser,
    "max": MaxParser,
    "isracard": IsracardParser,
}


def dispatch_pdf(path: str, timeout_seconds: int = _TIMEOUT_SECONDS) -> ParsedStatement:
    """Open *path*, detect the issuer, and parse the statement.

    Parameters
    ----------
    path:
        Absolute or relative filesystem path to the PDF file.
    timeout_seconds:
        Maximum wall-clock seconds allowed for parsing.  Defaults to 30 s
        (Rabin CC-12 §timeout requirement).  Raises :exc:`ParserTimeout` if
        the limit is exceeded.

    Returns
    -------
    ParsedStatement
        Parsed and structured statement data.

    Raises
    ------
    PDFTooLarge
        If the file exceeds 5 MB or the extracted text exceeds 500 KB.
    ParserTimeout
        If parsing takes longer than *timeout_seconds*.
    UnknownIssuer
        If the PDF cannot be fingerprinted to a known issuer.
    SecurityError
        If a full card number is detected in the document text.
    ParserError
        On any other unrecoverable parsing error.
    """
    # ── Security: file size check ────────────────────────────────────────
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        raise ParserError(f"Cannot stat PDF file: {path!r}") from exc

    if size > _MAX_FILE_BYTES:
        raise PDFTooLarge(f"PDF file is {size:,} bytes; limit is {_MAX_FILE_BYTES:,} bytes")

    # ── Thread-safe timeout via concurrent.futures ───────────────────────
    # ThreadPoolExecutor.Future.result(timeout=...) works in any thread,
    # unlike signal.SIGALRM which is restricted to the main thread.
    #
    # On timeout we call shutdown(wait=False) so the caller is not blocked
    # waiting for pdfplumber to yield.  The background thread is a daemon and
    # will be reaped when the worker process exits.  This is acceptable because
    # zombie parse threads are rare and bounded (one per timed-out PDF).
    # If hard-kill isolation is ever required, switch to subprocess isolation.
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_do_parse, path)
    try:
        result = future.result(timeout=timeout_seconds)
        executor.shutdown(wait=True)
        return result
    except FuturesTimeoutError:
        executor.shutdown(wait=False)  # don't block on hung pdfplumber thread
        raise ParserTimeout(f"PDF parsing exceeded {timeout_seconds}-second time limit")


def _do_parse(path: str) -> ParsedStatement:
    """Internal parse worker (submitted to ThreadPoolExecutor by dispatch_pdf)."""
    # Extract full text for fingerprinting
    try:
        pdf = pdfplumber.open(path)
    except Exception as exc:
        raise ParserError(f"Cannot open PDF: {path!r}") from exc

    with pdf:
        pages_text = [pg.extract_text() or "" for pg in pdf.pages]

    full_text = "\n".join(pages_text)

    # ── Security: text size check ────────────────────────────────────────
    text_bytes = len(full_text.encode("utf-8"))
    if text_bytes > _MAX_TEXT_BYTES:
        raise PDFTooLarge(f"Extracted text is {text_bytes:,} bytes; limit is {_MAX_TEXT_BYTES:,} bytes")

    # ── Issuer detection ────────────────────────────────────────────────
    issuer = detect_issuer(full_text)
    if issuer is None:
        raise UnknownIssuer(f"Cannot identify credit-card issuer from PDF: {path!r}")

    logger.debug("Detected issuer=%s for path=%r", issuer, path)

    # ── Parser dispatch ──────────────────────────────────────────────────
    parser_cls = _PARSER_MAP[issuer]
    parser = parser_cls()
    return parser.parse(path)
