"""Credit-card PDF parser package.

Provides :func:`dispatch_pdf` as the primary entry point.  Import it via::

    from app.services.expenses.parsers import dispatch_pdf, ParsedStatement
"""

from .base import (
    ParsedStatement,
    ParsedTransaction,
    ParserError,
    ParserTimeout,
    PDFTooLarge,
    SecurityError,
    UnknownIssuer,
)
from .dispatcher import dispatch_pdf

__all__ = [
    "dispatch_pdf",
    "ParsedStatement",
    "ParsedTransaction",
    "ParserError",
    "ParserTimeout",
    "PDFTooLarge",
    "SecurityError",
    "UnknownIssuer",
]
