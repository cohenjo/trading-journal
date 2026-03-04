"""
In-memory TTL cache for yfinance data.

Thread-safe caching with per-type TTLs and hit/miss tracking.
"""

import logging
import threading
from typing import Optional

from cachetools import TTLCache

logger = logging.getLogger("trading_journal.cache")

# Cache TTL constants (seconds)
PRICE_TTL = 300       # 5 minutes
FUNDAMENTALS_TTL = 3600  # 1 hour
TECHNICALS_TTL = 300  # 5 minutes
OPTIONS_TTL = 300     # 5 minutes

# ---------------------------------------------------------------------------
# Cache instances
# ---------------------------------------------------------------------------

_caches: dict[str, TTLCache] = {
    "price": TTLCache(maxsize=100, ttl=PRICE_TTL),
    "fundamentals": TTLCache(maxsize=50, ttl=FUNDAMENTALS_TTL),
    "technicals": TTLCache(maxsize=100, ttl=TECHNICALS_TTL),
    "options": TTLCache(maxsize=50, ttl=OPTIONS_TTL),
}

_lock = threading.Lock()

# Hit/miss counters
_stats: dict[str, dict[str, int]] = {
    name: {"hits": 0, "misses": 0} for name in _caches
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_cached(cache_type: str, key: str) -> Optional[dict]:
    """Retrieve a value from the specified cache. Returns None on miss."""
    cache = _caches.get(cache_type)
    if cache is None:
        return None

    with _lock:
        value = cache.get(key)
        if value is not None:
            _stats[cache_type]["hits"] += 1
            logger.debug("Cache HIT  [%s] %s", cache_type, key)
            return value
        _stats[cache_type]["misses"] += 1
        logger.debug("Cache MISS [%s] %s", cache_type, key)
        return None


def set_cached(cache_type: str, key: str, value: dict) -> None:
    """Store a value in the specified cache."""
    cache = _caches.get(cache_type)
    if cache is None:
        return

    with _lock:
        cache[key] = value
        logger.debug("Cache SET  [%s] %s", cache_type, key)


def get_cache_stats() -> dict:
    """Return hit/miss counts and ratios per cache type."""
    with _lock:
        result: dict = {}
        for name, counters in _stats.items():
            hits = counters["hits"]
            misses = counters["misses"]
            total = hits + misses
            result[name] = {
                "hits": hits,
                "misses": misses,
                "total": total,
                "hit_ratio": round(hits / total, 4) if total > 0 else 0.0,
                "size": len(_caches[name]),
                "maxsize": _caches[name].maxsize,
                "ttl": int(_caches[name].ttl),
            }
        return result
