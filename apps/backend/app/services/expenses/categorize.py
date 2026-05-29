"""Credit-card transaction categorization engine (3-tier deterministic).

Tier 1: Issuer-reported sector field → category.
Tier 2: Deterministic YAML rules (regex on merchant_normalized).
Tier 3: Learned merchant_category_mappings from DB.
Unresolved: ends up in resolution queue.

Authored by Hockney (CC-4). Source of truth for category metadata:
apps/backend/app/services/expenses/category_rules.yaml (owned by McManus).

Resolution order
----------------
1. Transfer pre-check (YAML transfers/* rules — must run first so transfers
   are never mis-counted as expenses).
2. Tier 1: Issuer sector field (Cal / Isracard provide Hebrew ענף).
3. User-confirmed DB mappings (source='user') — explicit user preference beats
   automated rules.
4. Tier 2: YAML rules (subcategory patterns first, then top-level; highest
   weight wins; ties broken by slug alphabetically).
5. Tier 3: Non-user DB mappings (source='rule' | 'inferred') — weakest signal.
6. Fallback: resolution_status='unresolved', category_id=NULL.

Note on Hebrew extraction (critical):
--------------------------------------
pdfplumber extracts Cal / Isracard Hebrew PDFs in visual left-to-right order.
Each Hebrew WORD has its characters reversed relative to logical Unicode.
  שופרסל → extracted as לסרפוש
  ביטוח  → extracted as חוטיב
  דלק    → extracted as קלד
Patterns in category_rules.yaml are written for the EXTRACTED (reversed) form.
The sector lookup table below also uses the extracted form.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable
from uuid import UUID

import yaml
from sqlmodel import Session, select

from app.schema.expenses import ExpenseCategory, MerchantCategoryMapping

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CATEGORY_RULES_PATH = Path(__file__).parent / "category_rules.yaml"

_DEFAULT_RULE_WEIGHT = 0.5

# Hebrew sector strings in EXTRACTED (visual / reversed) form → category slug.
# Cal and Isracard include a Hebrew ענף (sector) field on domestic transactions.
# These strings are matched as substrings (case-insensitive) against sector_raw.
# ~18 entries covering all common Israeli CC sectors.
_SECTOR_TO_SLUG: dict[str, str] = {
    # Insurance (ביטוח → extracted חוטיב)
    "חוטיב": "financial-insurance",
    # Food / Groceries (מזון → ןוזמ; אוכל → לכוא)
    "ןוזמ": "groceries",
    "לכוא": "groceries",
    # Restaurants / Cafés (מסעדות → תודעסמ; קפה → הפק)
    "תודעסמ": "restaurants",
    "הפק": "restaurants",
    # Fuel (דלק → קלד)
    "קלד": "fuel",
    # Communications / Utilities (תקשורת → תרושקת)
    "תרושקת": "utilities",
    # Clothing (הלבשה → השבלה)
    "השבלה": "shopping",
    # Health (בריאות → תואירב)
    "תואירב": "health",
    # Travel / Tourism (נסיעות → תועיסנ; תיירות → תרייות)
    "תועיסנ": "travel",
    "תרייות": "travel",
    # Leisure / Entertainment (פנאי → יאנפ)
    "יאנפ": "travel",
    # Auto / Garage (מכונאית → תיאנוכמ)
    "תיאנוכמ": "travel",
    # Education (חינוך → ךוניח)
    "ךוניח": "kids-education",
    # Shopping (קניות → תויינק)
    "תויינק": "shopping",
    # Finance / Government (הכנסה → הסנכה; עירייה → הייריע)
    "הסנכה": "financial",
    "הייריע": "financial",
    # National Insurance (ביטוח לאומי → יאמול חוטיב; sector appears as ילאומ)
    "ילאומ": "financial",
}


# ---------------------------------------------------------------------------
# ParsedTransaction protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ParsedTransaction(Protocol):
    """Protocol for a parsed CC transaction line-item.

    Satisfied by ``apps.backend.app.services.expenses.parsers.base.ParsedTransaction``
    once CC-2 ships.  Until then, synthetic objects matching this protocol
    can be used directly in tests.
    """

    merchant_raw: str
    merchant_normalized: str
    sector_raw: Optional[str]


# ---------------------------------------------------------------------------
# CategoryAssignment dataclass
# ---------------------------------------------------------------------------


@dataclass
class CategoryAssignment:
    """Result of one round of categorization for a single transaction.

    Fields
    ------
    category_id:       UUID of the matched top-level ExpenseCategory, or None.
    subcategory_id:    UUID of the matched subcategory, or None.
    resolution_status: 'auto' | 'transfer' | 'unresolved'
    resolution_source: 'sector' | 'rule' | 'mapping' | None
    is_transfer:       True when the category is a cash-transfer (PayBox etc.)
                       Transfers are excluded from household expense totals.
    """

    category_id: Optional[UUID] = None
    subcategory_id: Optional[UUID] = None
    resolution_status: str = "unresolved"
    resolution_source: Optional[str] = None
    is_transfer: bool = False


# ---------------------------------------------------------------------------
# Internal compiled-rule representation
# ---------------------------------------------------------------------------


@dataclass
class _CompiledRule:
    """Single pre-compiled regex rule from category_rules.yaml."""

    regex: re.Pattern[str]
    weight: float
    category_slug: str
    subcategory_slug: Optional[str]
    is_transfer: bool


def _compile_rules(yaml_data: dict) -> list[_CompiledRule]:
    """Build an ordered list of compiled regex rules from the YAML data dict.

    Subcategory rules are emitted BEFORE their parent top-level rules so that
    the more-specific subcategory wins when a merchant matches both levels.
    Within each level rules are ordered by ``display_order`` (YAML file order),
    which is why we preserve insertion order and sort only on weight at match
    time.
    """
    compiled: list[_CompiledRule] = []
    for cat in yaml_data.get("categories", []):
        cat_slug: str = cat["slug"]
        cat_is_transfer: bool = cat.get("is_transfer", False)

        # Emit subcategory rules first (more specific).
        for subcat in cat.get("subcategories", []):
            subcat_slug: str = subcat["slug"]
            subcat_is_transfer: bool = subcat.get("is_transfer", cat_is_transfer)
            for rule in subcat.get("rules", []):
                try:
                    compiled.append(
                        _CompiledRule(
                            regex=re.compile(rule["pattern"], re.IGNORECASE),
                            weight=float(rule.get("weight", _DEFAULT_RULE_WEIGHT)),
                            category_slug=cat_slug,
                            subcategory_slug=subcat_slug,
                            is_transfer=subcat_is_transfer,
                        )
                    )
                except re.error as exc:
                    logger.warning(
                        "Skipping invalid regex pattern for %s.%s: %s — %s",
                        cat_slug,
                        subcat_slug,
                        rule.get("pattern"),
                        exc,
                    )

        # Emit top-level category rules.
        for rule in cat.get("rules", []):
            try:
                compiled.append(
                    _CompiledRule(
                        regex=re.compile(rule["pattern"], re.IGNORECASE),
                        weight=float(rule.get("weight", _DEFAULT_RULE_WEIGHT)),
                        category_slug=cat_slug,
                        subcategory_slug=None,
                        is_transfer=cat_is_transfer,
                    )
                )
            except re.error as exc:
                logger.warning(
                    "Skipping invalid regex pattern for %s: %s — %s",
                    cat_slug,
                    rule.get("pattern"),
                    exc,
                )
    return compiled


# ---------------------------------------------------------------------------
# CategoryRulesCache
# ---------------------------------------------------------------------------


class CategoryRulesCache:
    """Loads category_rules.yaml once at init, compiles regexes, indexes by slug.

    Designed to be process-scoped (one instance per worker process).  Call
    ``reload()`` in tests after patching the YAML path.
    """

    def __init__(self, rules_path: Path = CATEGORY_RULES_PATH) -> None:
        self._path = rules_path
        self._compiled: list[_CompiledRule] = []
        self._transfer_slugs: set[str] = set()
        self.reload()

    def reload(self) -> None:
        """(Re)load YAML and recompile all regexes.  Thread-unsafe — call at startup."""
        with self._path.open(encoding="utf-8") as fh:
            yaml_data: dict = yaml.safe_load(fh)
        self._compiled = _compile_rules(yaml_data)
        # Collect all category / subcategory slugs marked is_transfer=true.
        self._transfer_slugs = {rule.category_slug for rule in self._compiled if rule.is_transfer} | {
            rule.subcategory_slug for rule in self._compiled if rule.is_transfer and rule.subcategory_slug
        }
        logger.info(
            "CategoryRulesCache: loaded %d compiled rules from %s",
            len(self._compiled),
            self._path,
        )

    @property
    def compiled_rules(self) -> list[_CompiledRule]:
        return self._compiled

    @property
    def transfer_slugs(self) -> set[str]:
        return self._transfer_slugs


# ---------------------------------------------------------------------------
# Module-level cache (process-scoped singleton instances)
# ---------------------------------------------------------------------------

_default_rules_cache: Optional[CategoryRulesCache] = None
# Module-level slug → UUID map; refresh via _load_categories_from_db().
_CATEGORY_SLUG_CACHE: dict[str, UUID] = {}


def _get_default_rules_cache() -> CategoryRulesCache:
    """Return (or create) the process-level CategoryRulesCache singleton."""
    global _default_rules_cache
    if _default_rules_cache is None:
        _default_rules_cache = CategoryRulesCache()
    return _default_rules_cache


def _load_categories_from_db(db: Session) -> dict[str, UUID]:
    """Return slug → UUID mapping for all expense categories.

    Results are cached in a module-level dict to avoid repeated DB round-trips.
    Call ``_invalidate_category_cache()`` in tests or after seeding the DB.
    """
    global _CATEGORY_SLUG_CACHE
    if _CATEGORY_SLUG_CACHE:
        return _CATEGORY_SLUG_CACHE
    rows = db.exec(select(ExpenseCategory)).all()
    _CATEGORY_SLUG_CACHE = {row.slug: row.id for row in rows}
    logger.debug("Loaded %d category slugs from DB", len(_CATEGORY_SLUG_CACHE))
    return _CATEGORY_SLUG_CACHE


def _invalidate_category_cache() -> None:
    """Clear the module-level category slug cache.

    Call this in test fixtures after seeding the in-memory DB so the resolver
    picks up the freshly inserted categories.
    """
    global _CATEGORY_SLUG_CACHE
    _CATEGORY_SLUG_CACHE = {}


# ---------------------------------------------------------------------------
# CategoryResolver
# ---------------------------------------------------------------------------


class CategoryResolver:
    """3-tier deterministic categorization engine for credit-card transactions.

    Designed as a process-scoped singleton (FastAPI dependency that lives for
    the lifetime of the worker process).  Creating one instance and reusing it
    is strongly preferred over constructing per-request to avoid re-loading and
    re-compiling 113 regexes on every call.

    Usage
    -----
    resolver = CategoryResolver()  # process scope
    assignment = resolver.resolve(txn, db_session, household_id)
    """

    def __init__(self, rules_cache: Optional[CategoryRulesCache] = None) -> None:
        self._cache = rules_cache or _get_default_rules_cache()

    def resolve(
        self,
        txn: ParsedTransaction,
        db: Session,
        household_id: UUID,
    ) -> CategoryAssignment:
        """Resolve category for a single parsed transaction.

        Parameters
        ----------
        txn:          Parsed transaction (merchant_normalized, sector_raw, …).
        db:           Active SQLModel Session for tier-3 DB queries.
        household_id: UUID of the current household for scoped mapping lookup.

        Returns
        -------
        CategoryAssignment with category_id, subcategory_id, resolution_status,
        resolution_source, and is_transfer flag.
        """
        slug_map = _load_categories_from_db(db)

        # ── Transfer pre-check ─────────────────────────────────────────────
        # Must run before all tiers so PayBox/Bit transfers are never
        # mis-categorised as expenses and incorrectly included in totals.
        transfer_result = self._check_transfer(txn.merchant_normalized, slug_map)
        if transfer_result is not None:
            return transfer_result

        # ── Tier 1: Issuer sector field ────────────────────────────────────
        if txn.sector_raw:
            sector_result = self._resolve_sector(txn.sector_raw, slug_map)
            if sector_result is not None:
                return sector_result
            # Unknown sector → fall through silently (do not log as error)

        # ── Tier 3-A: User-confirmed DB mappings ──────────────────────────
        # User-explicit preferences beat YAML rules (user correction wins).
        user_mapping = self._query_mapping(
            txn.merchant_normalized,
            household_id,
            db,
            user_only=True,
        )
        if user_mapping is not None:
            return self._assignment_from_mapping(user_mapping, slug_map)

        # ── Tier 2: Deterministic YAML rules ──────────────────────────────
        rule_result = self._resolve_rules(txn.merchant_normalized, slug_map)
        if rule_result is not None:
            return rule_result

        # ── Tier 3-B: Learned / inferred DB mappings ──────────────────────
        inferred_mapping = self._query_mapping(
            txn.merchant_normalized,
            household_id,
            db,
            user_only=False,
        )
        if inferred_mapping is not None:
            return self._assignment_from_mapping(inferred_mapping, slug_map)

        # ── Fallback: unresolved ───────────────────────────────────────────
        # NEVER silently assign 'other'.  User resolves via CC-7 UI.
        return CategoryAssignment(
            resolution_status="unresolved",
            resolution_source=None,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _check_transfer(
        self,
        merchant_normalized: str,
        slug_map: dict[str, UUID],
    ) -> Optional[CategoryAssignment]:
        """Return a transfer CategoryAssignment if the merchant matches any
        transfers/* rule, otherwise None.
        """
        transfer_rules = [r for r in self._cache.compiled_rules if r.is_transfer]
        matches: list[_CompiledRule] = [r for r in transfer_rules if r.regex.search(merchant_normalized)]
        if not matches:
            return None

        best = self._pick_best_match(matches)
        cat_id = slug_map.get(best.category_slug)
        subcat_id = slug_map.get(best.subcategory_slug) if best.subcategory_slug else None
        return CategoryAssignment(
            category_id=cat_id,
            subcategory_id=subcat_id,
            resolution_status="transfer",
            resolution_source="rule",
            is_transfer=True,
        )

    def _resolve_sector(
        self,
        sector_raw: str,
        slug_map: dict[str, UUID],
    ) -> Optional[CategoryAssignment]:
        """Map issuer sector_raw → category slug via substring lookup.

        The sector string is compared case-insensitively; we scan every entry
        in ``_SECTOR_TO_SLUG`` and take the first match found (dict insertion
        order = Hebrew common-sector priority order).
        """
        sector_lower = sector_raw.lower()
        for sector_key, slug in _SECTOR_TO_SLUG.items():
            if sector_key.lower() in sector_lower:
                cat_id = slug_map.get(slug)
                if cat_id is None:
                    # Slug not in DB yet — skip this sector hit
                    logger.debug(
                        "Sector key '%s' → slug '%s' not found in DB categories",
                        sector_key,
                        slug,
                    )
                    continue
                return CategoryAssignment(
                    category_id=cat_id,
                    subcategory_id=None,
                    resolution_status="auto",
                    resolution_source="sector",
                    is_transfer=False,
                )
        return None

    def _resolve_rules(
        self,
        merchant_normalized: str,
        slug_map: dict[str, UUID],
    ) -> Optional[CategoryAssignment]:
        """Match merchant_normalized against all compiled YAML rules.

        Subcategory rules are checked before top-level rules (guaranteed by
        _compile_rules ordering).  Among all matches, the one with the highest
        weight wins; ties are broken alphabetically by
        ``category_slug/subcategory_slug``.
        """
        # Exclude transfer rules (already handled in pre-check).
        non_transfer_rules = [r for r in self._cache.compiled_rules if not r.is_transfer]
        matches: list[_CompiledRule] = [r for r in non_transfer_rules if r.regex.search(merchant_normalized)]
        if not matches:
            return None

        best = self._pick_best_match(matches)
        cat_id = slug_map.get(best.category_slug)
        subcat_id = slug_map.get(best.subcategory_slug) if best.subcategory_slug else None
        return CategoryAssignment(
            category_id=cat_id,
            subcategory_id=subcat_id,
            resolution_status="auto",
            resolution_source="rule",
            is_transfer=False,
        )

    @staticmethod
    def _pick_best_match(matches: list[_CompiledRule]) -> _CompiledRule:
        """Select the best match from a non-empty list of matching rules.

        Tie-breaking: highest weight wins; ties broken alphabetically by the
        combined slug key ``category_slug/subcategory_slug`` (deterministic
        across Python processes and reruns).
        """

        def sort_key(r: _CompiledRule) -> tuple[float, int, str]:
            # Primary: highest weight first (negate).
            # Secondary: subcategory rules beat parent-only rules (more specific wins).
            # Tertiary: alphabetical by combined slug for determinism.
            subcat_priority = 0 if r.subcategory_slug else 1
            slug_key = f"{r.category_slug}/{r.subcategory_slug or ''}"
            return (-r.weight, subcat_priority, slug_key)

        return sorted(matches, key=sort_key)[0]

    def _query_mapping(
        self,
        merchant_normalized: str,
        household_id: UUID,
        db: Session,
        user_only: bool,
    ) -> Optional[MerchantCategoryMapping]:
        """Query merchant_category_mappings for a match.

        Scope: household-specific rows take precedence over global (NULL)
        rows.  When ``user_only=True`` only source='user' rows are returned
        (user-confirmed preferences that beat YAML rules).

        Security: always scoped by household_id OR IS NULL — never returns
        another household's private mappings.  (Rabin's threat model §5.2)
        """
        stmt = select(MerchantCategoryMapping).where(
            MerchantCategoryMapping.merchant_normalized == merchant_normalized,
        )
        if user_only:
            stmt = stmt.where(MerchantCategoryMapping.source == "user")

        rows = db.exec(stmt).all()
        if not rows:
            return None

        # Filter to household-scoped + global rows only (enforce RLS in code).
        scoped = [r for r in rows if r.household_id == household_id]
        global_ = [r for r in rows if r.household_id is None]

        # Household-scoped wins over global.
        candidates = scoped or global_
        if not candidates:
            return None

        # Sort: household-scoped first, then by match_count desc (most-used),
        # then by created_at desc (most recent).
        candidates.sort(
            key=lambda r: (
                0 if r.household_id == household_id else 1,
                -(r.match_count or 0),
            )
        )
        chosen = candidates[0]

        # Audit: bump match_count and last_used_at (Rabin §5.2 hardening).
        chosen.match_count = (chosen.match_count or 0) + 1
        chosen.last_used_at = datetime.utcnow()
        db.add(chosen)
        db.commit()

        return chosen

    @staticmethod
    def _assignment_from_mapping(
        mapping: MerchantCategoryMapping,
        slug_map: dict[str, UUID],  # noqa: ARG004 — unused; IDs already on mapping
    ) -> CategoryAssignment:
        """Build a CategoryAssignment from a MerchantCategoryMapping row."""
        return CategoryAssignment(
            category_id=mapping.category_id,
            subcategory_id=mapping.subcategory_id,
            resolution_status="auto",
            resolution_source="mapping",
            is_transfer=False,
        )
