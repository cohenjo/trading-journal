---
name: "two-tier-api-retry"
description: "Design retry logic for external HTTP APIs with separate transport and application-level resilience"
domain: "error-handling, api-design, reliability"
confidence: "high"
source: "earned — learned from IBKR Flex API backfill resilience work (2026-05-06)"
---

## Context

When calling external HTTP APIs (especially third-party services like financial data providers), failures happen at two orthogonal layers:

1. **Transport layer** — TCP resets, SSL handshake failures, DNS timeouts, HTTP 5xx from edge/WAF
2. **Application layer** — Backend throttling, rate limits, resource exhaustion, queue backlogs

These failure classes have different timescales and need different retry strategies. Mixing them in a single retry loop creates incorrect behavior: either you retry application errors too quickly (worsening throttling) or you wait too long for transport errors (wasting time).

## Patterns

### Two-Tier Retry Architecture

```python
# Transport-level retry (fast, seconds-scale)
def _get_with_retries(
    url: str,
    params: dict,
    timeout: int,
    *,
    max_attempts: int = 5,
    initial_backoff: float = 5.0,  # seconds
    sleep: Callable = time.sleep,
) -> requests.Response:
    """Retry on TCP/SSL/5xx errors with exponential backoff."""
    backoff = initial_backoff
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if 500 <= response.status_code < 600:
                # Retry 5xx (edge/WAF issues)
                if attempt < max_attempts:
                    jitter = random.uniform(0.8, 1.2)
                    sleep_time = min(backoff * jitter, 80.0)  # cap at 80s
                    sleep(sleep_time)
                    backoff *= 2
                    continue
            return response
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.SSLError):
            if attempt < max_attempts:
                jitter = random.uniform(0.8, 1.2)
                sleep_time = min(backoff * jitter, 80.0)
                sleep(sleep_time)
                backoff *= 2
                continue
            raise
    raise FlexProbeError("Transport retries exhausted")

# Application-level retry (slow, minutes-scale)
def send_request(
    config: Config,
    token: str,
    *,
    max_retries: int = 5,
    initial_backoff_seconds: float = 60.0,  # minutes
    sleep: Callable = time.sleep,
) -> str:
    """Retry on application throttle errors with long backoff."""
    backoff = initial_backoff_seconds
    elapsed_total = 0.0
    for attempt in range(1, max_retries + 1):
        # Use transport-layer retry for the HTTP call
        response = _get_with_retries(url, params, timeout, sleep=sleep)
        root = parse_xml(response.content)
        error_code, error_message = parse_error(root)

        # Application-layer throttle (e.g., IBKR 1001)
        if error_code == "1001":
            if attempt < max_retries:
                jitter = random.uniform(0.8, 1.2)
                sleep_time = min(backoff * jitter, 600.0)  # cap at 10 min
                print(f"Throttle (attempt {attempt}/{max_retries}); "
                      f"sleeping {sleep_time:.0f}s (total wait: {elapsed_total:.0f}s)")
                sleep(sleep_time)
                elapsed_total += sleep_time
                backoff = min(backoff * 2, 600.0)
                continue
            # Exhausted — raise with guidance
            break

        # Other errors fail fast
        if error_code and error_code != "0":
            raise APIError(f"Request failed: {error_code} {error_message}")

        return parse_success(root)

    raise APIError(
        f"Throttle persists after {max_retries} retries ({elapsed_total:.0f}s elapsed). "
        f"Recommended: wait ~30 minutes and retry, OR check service status."
    )
```

### Environment-Tunable Constants

Make retry budgets configurable without code changes:

```python
# Module-level constants read from env vars at import time
TRANSPORT_MAX_ATTEMPTS = int(os.environ.get("API_TRANSPORT_MAX_ATTEMPTS", "5"))
TRANSPORT_INITIAL_BACKOFF = float(os.environ.get("API_TRANSPORT_INITIAL_BACKOFF", "5.0"))
APP_MAX_RETRIES = int(os.environ.get("API_APP_MAX_RETRIES", "5"))
APP_INITIAL_BACKOFF = float(os.environ.get("API_APP_INITIAL_BACKOFF", "60.0"))

# Use as function defaults
def send_request(
    config: Config,
    token: str,
    *,
    max_retries: int = APP_MAX_RETRIES,
    initial_backoff_seconds: float = APP_INITIAL_BACKOFF,
    sleep: Callable = time.sleep,
) -> str:
    ...
```

Operators can adjust without code changes: `API_APP_MAX_RETRIES=10 python backfill.py`

### Elapsed Time Tracking

Show cumulative wait time so users know progress during long waits:

```python
elapsed_total = 0.0
for attempt in range(1, max_retries + 1):
    ...
    if needs_retry:
        sleep_time = calculate_backoff()
        print(f"Retry (attempt {attempt}/{max_retries}); "
              f"sleeping {sleep_time:.0f}s (total wait so far: {elapsed_total:.0f}s)")
        sleep(sleep_time)
        elapsed_total += sleep_time  # accumulate AFTER printing
        continue

# Include in exhaustion error
raise APIError(
    f"Failed after {max_retries} retries ({elapsed_total:.0f}s elapsed). ..."
)
```

### Actionable Error Messages

When retries are exhausted, guide users on what to do next:

```python
raise APIError(
    f"Throttle persists after {max_retries} retries ({elapsed_total:.0f}s elapsed). "
    f"Service backend appears unhealthy for request_id={request_id}. "
    f"Recommended: wait ~30 minutes and retry, OR check service status page "
    f"at https://status.example.com. Persistent throttling typically clears overnight. "
    f"Last service message: {last_message or 'none'}"
)
```

Include:
- Elapsed wait time
- Request ID for correlation
- Specific recommendations
- Link to status page (if available)
- Last error message from service

## Examples

### Real-World: IBKR Flex API

**Transport layer** (5s→80s, 5 attempts):
- Handles SSL handshake failures, TCP resets, HTTP 503 from edge/WAF
- Fast recovery for transient network issues
- Max wait: ~4 min

**Application layer** (60s→600s, 5 attempts):
- Handles error 1001 ("Statement could not be generated")
- IBKR's backend statement generation queue
- Max wait: ~25 min

Files: `apps/backend/scripts/flex_probe.py` lines 70-130 (transport), 211-275 (application)

### Testing Pattern

Thread sleep parameter through the call chain for testability:

```python
def send_request(..., sleep: Callable = time.sleep):
    response = _get_with_retries(..., sleep=sleep)
    ...
    sleep(backoff)

# In tests:
sleeps: list[float] = []
send_request(config, token, sleep=sleeps.append)
assert sleeps == [60.0, 120.0]  # verify backoff sequence
```

## Anti-Patterns

### ❌ Single retry loop for both layers

```python
for attempt in range(1, 10):
    try:
        response = requests.get(url)  # no transport retry
        if is_throttled(response):
            sleep(300)  # 5 min wait for every failure — too slow for TCP reset
            continue
    except ConnectionError:
        sleep(300)  # wasting 5 minutes on a TCP blip
        continue
```

### ❌ Retry application errors too quickly

```python
# Application throttle needs time to clear, not fast retries
for attempt in range(1, 20):
    if error_code == "1001":
        sleep(5)  # IBKR backend won't clear in 5s — just burns attempts
        continue
```

### ❌ Generic "Retry exhausted" errors

```python
raise APIError("Max retries exceeded")  # User has no idea what to do next
```

Better:
```python
raise APIError(
    f"Throttle persists after {retries} retries. Wait 30 min and retry, "
    f"OR check service status at https://status.example.com"
)
```

### ❌ Hard-coded retry budgets

```python
max_retries = 3  # User can't adjust without changing code
```

Better: env-tunable constants with sensible defaults.
