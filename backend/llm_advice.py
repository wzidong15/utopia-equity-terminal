"""LLM investment advice — OpenAI or Anthropic via httpx."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Literal

import httpx

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or ""
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY") or ""
OPENAI_MODEL = os.environ.get("OPENAI_MODEL") or "gpt-4.1"
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL") or "claude-opus-4-20250514"
LLM_PROVIDER = (os.environ.get("LLM_PROVIDER") or "auto").strip().lower()

VALID_ACTIONS = {"BUY", "SELL", "LONG CALL", "LONG PUT"}

SYSTEM_PROMPT = """You are a disciplined US equity research analyst.
Given JSON context for one stock plus macro indices (SPY, QQQ, DIA, IWM, VIX), produce ONE recommendation.

Allowed actions (pick exactly one):
- BUY — own shares / add equity exposure
- SELL — exit or reduce equity exposure
- LONG CALL — bullish options expression
- LONG PUT — bearish or hedge options expression

Weigh macro (risk-on/off, VIX level/trend) against stock-specific data (technicals, fundamentals, insiders, options flow, news, analyst targets).

Respond with JSON only (no markdown fences), schema:
{
  "action": "BUY" | "SELL" | "LONG CALL" | "LONG PUT",
  "confidence": "high" | "medium" | "low",
  "thesis": "2-4 sentences",
  "reasons": ["bullet 1", "bullet 2", "..."],
  "macro_view": "1-3 sentences on SPY/QQQ/VIX impact",
  "risks": ["risk 1", "risk 2"],
  "time_horizon": "days" | "weeks" | "months"
}
Not financial advice; be explicit about uncertainty when data is thin."""


def llm_configured() -> dict[str, bool]:
    return {
        "openai": bool(OPENAI_API_KEY),
        "anthropic": bool(ANTHROPIC_API_KEY),
        "any": bool(OPENAI_API_KEY or ANTHROPIC_API_KEY),
    }


def _pick_provider() -> Literal["openai", "anthropic"]:
    if LLM_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return "openai"
    if LLM_PROVIDER == "anthropic":
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        return "anthropic"
    if OPENAI_API_KEY:
        return "openai"
    if ANTHROPIC_API_KEY:
        return "anthropic"
    raise RuntimeError("Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env")


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        obj = json.loads(match.group(0))
        if isinstance(obj, dict):
            return obj
    raise RuntimeError("LLM response was not valid JSON")


def _normalize_advice(raw: dict[str, Any], provider: str, model: str) -> dict[str, Any]:
    action = str(raw.get("action") or "").upper().strip()
    action = action.replace("_", " ")
    if action == "LONGCALL":
        action = "LONG CALL"
    if action == "LONGPUT":
        action = "LONG PUT"
    if action not in VALID_ACTIONS:
        for candidate in VALID_ACTIONS:
            if candidate in action:
                action = candidate
                break
        else:
            action = "BUY"

    conf = str(raw.get("confidence") or "medium").lower()
    if conf not in ("high", "medium", "low"):
        conf = "medium"

    reasons = raw.get("reasons") or []
    if not isinstance(reasons, list):
        reasons = [str(reasons)]
    reasons = [str(r).strip() for r in reasons if str(r).strip()][:8]

    risks = raw.get("risks") or []
    if not isinstance(risks, list):
        risks = [str(risks)]
    risks = [str(r).strip() for r in risks if str(r).strip()][:6]

    horizon = str(raw.get("time_horizon") or "weeks").lower()
    if horizon not in ("days", "weeks", "months"):
        horizon = "weeks"

    return {
        "action": action,
        "confidence": conf,
        "thesis": str(raw.get("thesis") or "").strip(),
        "reasons": reasons,
        "macro_view": str(raw.get("macro_view") or "").strip(),
        "risks": risks,
        "time_horizon": horizon,
        "provider": provider,
        "model": model,
        "disclaimer": "AI-generated research view, not financial advice. You can lose money.",
    }


def _call_openai(user_content: str) -> str:
    body = {
        "model": OPENAI_MODEL,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    with httpx.Client(timeout=90.0) as client:
        r = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=body,
        )
        r.raise_for_status()
        data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("OpenAI returned no choices")
    return str((choices[0].get("message") or {}).get("content") or "")


def _call_anthropic(user_content: str) -> str:
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1200,
        "temperature": 0.3,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_content}],
    }
    with httpx.Client(timeout=90.0) as client:
        r = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        r.raise_for_status()
        data = r.json()
    blocks = data.get("content") or []
    parts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    text = "".join(parts).strip()
    if not text:
        raise RuntimeError("Anthropic returned empty content")
    return text


def generate_investment_advice(context: dict[str, Any]) -> dict[str, Any]:
    provider = _pick_provider()
    user_content = (
        "Analyze the following market context and return JSON per the schema.\n\n"
        + json.dumps(context, indent=2, default=str)
    )
    if provider == "openai":
        raw_text = _call_openai(user_content)
        model = OPENAI_MODEL
    else:
        raw_text = _call_anthropic(user_content)
        model = ANTHROPIC_MODEL
    parsed = _extract_json(raw_text)
    return _normalize_advice(parsed, provider, model)
