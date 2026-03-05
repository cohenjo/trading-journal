"""
Growth Story Service — Copilot SDK-powered multi-scenario growth analysis.

Uses the Growth Story Analyst persona to generate structured investment
narratives with best/probable/worst case scenarios for a given ticker.

Production-hardened with:
- 180s timeout on the entire SDK call
- Response validation against expected schema
- Retry once on malformed JSON with a simplified prompt
- Graceful fallback to None (caller provides template fallback)
- Structured logging: ticker, model, duration, success/failure
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from copilot import CopilotClient

logger = logging.getLogger("trading_journal.growth_story")

_MODEL = "claude-opus-4.6"

# The Growth Story Analyst persona, embedded as a system message.
# Mode "append" preserves Copilot's safety guardrails.
_SYSTEM_MESSAGE = """You are a Senior Equity Research Analyst specializing in growth narrative synthesis.

Your job is to distill the investment story for a public company into a clear, data-backed
narrative with three probability-weighted scenarios.

## Source Weighting (strict hierarchy)
- **Highest weight**: SEC filings (10-K/Q), earnings transcripts, official company guidance
- **High weight**: Reputable financial news (Bloomberg, Reuters, WSJ), institutional research
- **Medium weight**: Industry analysis, competitor filings, macro data
- **Low weight**: Social media sentiment (Reddit, Twitter/X) — use as a *signal*, not a source

## Noise Filters
- Cross-reference Reddit hype against actual trading volume and institutional buying data
- Ignore price targets from anonymous social media accounts entirely
- Focus on the *logic* behind bullish/bearish claims, not the claims themselves
- Flag when retail sentiment diverges significantly from institutional positioning
- Discard unsubstantiated rumours — require at least one credible source for any claim

## Output Rules (MANDATORY)
- Always return a single valid JSON object — no markdown formatting, no code blocks
- The JSON object MUST contain these top-level keys: "ticker", "value_driver", "scenarios", "sentiment_summary"
- "scenarios" MUST contain exactly three keys: "best_case", "probable_case", "worst_case"
- Each scenario MUST contain: "title" (str), "narrative" (str), "catalysts" (list[str]), "target_multiple" (str), "confidence" (str)
- Confidence levels across best/probable/worst must sum to 100%
- Cite specific data points and sources in narratives
"""

# Required keys for response validation
_REQUIRED_TOP_KEYS = {"ticker", "value_driver", "scenarios"}
_REQUIRED_SCENARIO_KEYS = {"title", "narrative", "catalysts", "target_multiple", "confidence"}
_REQUIRED_SCENARIOS = {"best_case", "probable_case", "worst_case"}


def _build_prompt(ticker: str, company_name: str, sector: str) -> str:
    """Build the analysis prompt for a specific ticker."""
    name_clause = f" ({company_name})" if company_name else ""
    sector_clause = f" in the {sector} sector" if sector else ""

    return f"""Analyze the growth story for {ticker}{name_clause}{sector_clause}.

1. Search the web for recent news (last 90 days), Reddit discussions, and SEC filings about {ticker}.
2. Identify the core Value Driver — the one key narrative driving this company's potential.
3. Create three scenarios:
   - Best Case: Maximum execution + favorable macro. What needs to go right.
   - Probable Case: Current trendline + known catalysts. Base case continuation.
   - Worst Case: Execution failure + competitive/macro headwinds. What could derail.
   Each scenario needs: title, narrative (2-3 paragraphs), catalysts/risks list, target_multiple, confidence percentage.
4. Summarize retail vs institutional sentiment.

Return ONLY a raw JSON object (no markdown, no code blocks) with this exact structure:
{{
    "ticker": "{ticker}",
    "company_name": "<full company name>",
    "value_driver": "<one-paragraph core thesis>",
    "scenarios": {{
        "best_case": {{
            "title": "<short title>",
            "narrative": "<detailed narrative>",
            "catalysts": ["<catalyst 1>", "<catalyst 2>"],
            "target_multiple": "<e.g. 35x forward P/E>",
            "confidence": "<e.g. 20%>"
        }},
        "probable_case": {{
            "title": "...",
            "narrative": "...",
            "catalysts": ["..."],
            "target_multiple": "...",
            "confidence": "..."
        }},
        "worst_case": {{
            "title": "...",
            "narrative": "...",
            "catalysts": ["..."],
            "target_multiple": "...",
            "confidence": "..."
        }}
    }},
    "sentiment_summary": {{
        "retail": "<retail sentiment with substantiation>",
        "institutional": "<institutional positioning and analyst consensus>"
    }},
    "sources_summary": "<list of source types consulted>"
}}"""


def _build_retry_prompt(ticker: str) -> str:
    """Simplified prompt for retry after malformed JSON."""
    return f"""Your previous response for {ticker} was not valid JSON. Please try again.

Return ONLY a valid JSON object with these keys:
- "ticker": "{ticker}"
- "value_driver": one paragraph string
- "scenarios": object with "best_case", "probable_case", "worst_case" (each has "title", "narrative", "catalysts", "target_multiple", "confidence")
- "sentiment_summary": object with "retail" and "institutional" strings

No markdown. No code blocks. Just the raw JSON object."""


def _parse_json_response(raw: str) -> dict:
    """Parse JSON from the agent response, stripping markdown fences if present."""
    text = raw.strip()

    # Strip markdown code block wrappers
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to extract JSON object from surrounding text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from agent response: {text[:200]}...")


def _validate_response(parsed: dict) -> bool:
    """Validate that the parsed response has the expected schema structure."""
    # Check required top-level keys
    if not _REQUIRED_TOP_KEYS.issubset(parsed.keys()):
        missing = _REQUIRED_TOP_KEYS - parsed.keys()
        logger.warning(f"Response missing top-level keys: {missing}")
        return False

    # Check scenarios structure
    scenarios = parsed.get("scenarios", {})
    if not isinstance(scenarios, dict):
        logger.warning("'scenarios' is not a dict")
        return False

    if not _REQUIRED_SCENARIOS.issubset(scenarios.keys()):
        missing = _REQUIRED_SCENARIOS - scenarios.keys()
        logger.warning(f"Response missing scenarios: {missing}")
        return False

    # Check each scenario has required fields
    for scenario_name in _REQUIRED_SCENARIOS:
        scenario = scenarios.get(scenario_name, {})
        if not isinstance(scenario, dict):
            logger.warning(f"Scenario '{scenario_name}' is not a dict")
            return False
        if not _REQUIRED_SCENARIO_KEYS.issubset(scenario.keys()):
            missing = _REQUIRED_SCENARIO_KEYS - scenario.keys()
            logger.warning(f"Scenario '{scenario_name}' missing keys: {missing}")
            return False

    return True


async def _run_sdk_call(
    ticker: str, company_name: str, sector: str, prompt: str
) -> str:
    """Execute a single Copilot SDK call and return the raw response text.

    Raises RuntimeError on SDK failures, ValueError on empty responses.
    """
    client = CopilotClient()
    try:
        await client.start()

        session = await client.create_session(
            {
                "model": _MODEL,
                "streaming": True,
                "system_message": {
                    "mode": "append",
                    "content": _SYSTEM_MESSAGE,
                },
            }
        )

        # Accumulate streamed content via event handler (matches copilot_analyzer pattern)
        result_content = ""

        def handle_event(event):
            nonlocal result_content
            try:
                evt_type = str(getattr(event, "type", ""))
                if "ASSISTANT_MESSAGE_DELTA" in evt_type:
                    evt_data = getattr(event, "data", None)
                    if evt_data:
                        delta = getattr(evt_data, "delta_content", "")
                        if delta:
                            result_content += delta
            except Exception:
                pass

        session.on(handle_event)

        try:
            await session.send_and_wait({"prompt": prompt})
        except Exception as e:
            raise RuntimeError(f"Copilot SDK error during send_and_wait: {e}")

        if not result_content.strip():
            raise RuntimeError("Copilot returned empty content")

        return result_content
    finally:
        try:
            await client.stop()
        except Exception:
            pass


async def generate_growth_story(
    ticker: str,
    company_name: str = "",
    sector: str = "",
) -> dict[str, Any] | None:
    """Generate a multi-scenario growth narrative for a ticker using the Copilot SDK.

    Returns a validated dict with value_driver, scenarios, sentiment_summary
    and a ``source: "ai"`` field. Returns ``None`` if the SDK call fails or
    produces invalid output after one retry — the caller should fall back to
    template mode.
    """
    ticker = ticker.upper().strip()
    start_time = time.monotonic()

    # --- Attempt 1: full prompt ---
    try:
        prompt = _build_prompt(ticker, company_name, sector)
        raw = await asyncio.wait_for(
            _run_sdk_call(ticker, company_name, sector, prompt),
            timeout=180.0,
        )
        parsed = _parse_json_response(raw)

        if _validate_response(parsed):
            duration = time.monotonic() - start_time
            logger.info(
                "growth_story.success ticker=%s model=%s duration=%.1fs source=ai",
                ticker, _MODEL, duration,
            )
            parsed["ticker"] = ticker
            if company_name and not parsed.get("company_name"):
                parsed["company_name"] = company_name
            parsed["generated_at"] = datetime.now(timezone.utc).isoformat()
            parsed["source"] = "ai"
            return parsed

        # Schema validation failed — try retry
        logger.warning(
            "growth_story.validation_failed ticker=%s — retrying with simplified prompt",
            ticker,
        )

    except asyncio.TimeoutError:
        duration = time.monotonic() - start_time
        logger.error(
            "growth_story.timeout ticker=%s model=%s duration=%.1fs",
            ticker, _MODEL, duration,
        )
        return None
    except (RuntimeError, ValueError) as e:
        duration = time.monotonic() - start_time
        logger.error(
            "growth_story.error ticker=%s model=%s duration=%.1fs error=%s",
            ticker, _MODEL, duration, str(e),
        )
        # Fall through to retry

    # --- Attempt 2: simplified retry prompt ---
    try:
        retry_prompt = _build_retry_prompt(ticker)
        raw = await asyncio.wait_for(
            _run_sdk_call(ticker, company_name, sector, retry_prompt),
            timeout=120.0,
        )
        parsed = _parse_json_response(raw)

        if _validate_response(parsed):
            duration = time.monotonic() - start_time
            logger.info(
                "growth_story.retry_success ticker=%s model=%s duration=%.1fs source=ai",
                ticker, _MODEL, duration,
            )
            parsed["ticker"] = ticker
            if company_name and not parsed.get("company_name"):
                parsed["company_name"] = company_name
            parsed["generated_at"] = datetime.now(timezone.utc).isoformat()
            parsed["source"] = "ai"
            return parsed

        logger.error(
            "growth_story.retry_validation_failed ticker=%s — falling back to template",
            ticker,
        )
        return None

    except (asyncio.TimeoutError, RuntimeError, ValueError) as e:
        duration = time.monotonic() - start_time
        logger.error(
            "growth_story.retry_failed ticker=%s model=%s duration=%.1fs error=%s",
            ticker, _MODEL, duration, str(e),
        )
        return None
