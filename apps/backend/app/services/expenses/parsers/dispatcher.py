"""PDF dispatcher: open a credit-card PDF, fingerprint it, and route to the
correct parser.

Security conditions from Rabin CC-2 review:
- File size limit: 5 MB (PDFTooLarge raised before opening)
- Text size limit: 500 KB (PDFTooLarge raised after extraction)
- Timeout: 30 s via SIGALRM (ParserTimeout raised on signal)
- Full card-number scrub enforced inside each parser (SecurityError)
"""

from __future__ import annotations

import logging
import os
import signal
from typing import NoReturn

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


def _timeout_handler(signum: int, frame: object) -> NoReturn:
    raise ParserTimeout("PDF parsing exceeded 30-second time limit")


def dispatch_pdf(path: str) -> ParsedStatement:
    """Open *path*, detect the issuer, and parse the statement.

    Parameters
    ----------
    path:
        Absolute or relative filesystem path to the PDF file.

    Returns
    -------
    ParsedStatement
        Parsed and structured statement data.

    Raises
    ------
    PDFTooLarge
        If the file exceeds 5 MB or the extracted text exceeds 500 KB.
    ParserTimeout
        If parsing takes longer than 30 seconds.
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

    # ── Security: SIGALRM timeout ────────────────────────────────────────
    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(_TIMEOUT_SECONDS)

    try:
        result = _do_parse(path)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)

    return result


def _do_parse(path: str) -> ParsedStatement:
    """Internal parse (called inside the SIGALRM timeout context)."""
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
