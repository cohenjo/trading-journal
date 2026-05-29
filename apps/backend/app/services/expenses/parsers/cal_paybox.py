"""Cal PayBox credit-card PDF parser.

PayBox statements are structurally identical to Cal General statements but
carry the ``228899999`` merchant ID (instead of ``335399999``) and the
``סקובייפ`` / ``PayBox`` branding in the header.

This parser extends :class:`~.cal.CalParser` and overrides only the issuer
slug so that downstream components can identify PayBox-origin transactions.
"""

from __future__ import annotations

from .cal import CalParser


class CalPayBoxParser(CalParser):
    """Parse Cal PayBox credit-card PDF statements.

    Delegates all parsing logic to :class:`~.cal.CalParser`; the sole
    difference is that :attr:`ISSUER` is set to ``'cal_paybox'`` so the
    statement can be distinguished from ordinary Cal statements.
    """

    ISSUER = "cal_paybox"
