"""LLM investment advice — OpenAI or Anthropic via httpx."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Literal

import httpx


def _load_dotenv() -> None:
    """Pull repo-root .env into os.environ without overriding already-set vars."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and not os.environ.get(key):
            os.environ[key] = value


def _llm_settings() -> dict[str, str]:
    _load_dotenv()
    return {
        "openai_key": (os.environ.get("OPENAI_API_KEY") or "").strip(),
        "anthropic_key": (os.environ.get("ANTHROPIC_API_KEY") or "").strip(),
        "openai_model": (os.environ.get("OPENAI_MODEL") or "gpt-4.1").strip(),
        "anthropic_model": (os.environ.get("ANTHROPIC_MODEL") or "claude-opus-4-20250514").strip(),
        "provider": (os.environ.get("LLM_PROVIDER") or "auto").strip().lower(),
    }

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
    s = _llm_settings()
    return {
        "openai": bool(s["openai_key"]),
        "anthropic": bool(s["anthropic_key"]),
        "any": bool(s["openai_key"] or s["anthropic_key"]),
    }


def _pick_provider() -> Literal["openai", "anthropic"]:
    s = _llm_settings()
    if s["provider"] == "openai":
        if not s["openai_key"]:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return "openai"
    if s["provider"] == "anthropic":
        if not s["anthropic_key"]:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        return "anthropic"
    if s["openai_key"]:
        return "openai"
    if s["anthropic_key"]:
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


def _http_error_detail(res: httpx.Response) -> str:
    try:
        body = res.json()
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        if isinstance(body, dict) and body.get("message"):
            return str(body["message"])
        return json.dumps(body)[:800]
    except Exception:
        return (res.text or "")[:800]


def _anthropic_uses_adaptive_thinking(model: str) -> bool:
    m = model.lower()
    return any(
        token in m
        for token in (
            "opus-5",
            "sonnet-5",
            "haiku-5",
            "fable-5",
            "mythos-5",
            "opus-4-7",
            "opus-4-8",
            "sonnet-4-6",
            "opus-4-6",
        )
    )


def _call_openai(user_content: str) -> str:
    s = _llm_settings()
    body = {
        "model": s["openai_model"],
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
            headers={"Authorization": f"Bearer {s['openai_key']}"},
            json=body,
        )
        if r.is_error:
            raise RuntimeError(f"OpenAI {r.status_code}: {_http_error_detail(r)}")
        r.raise_for_status()
        data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("OpenAI returned no choices")
    return str((choices[0].get("message") or {}).get("content") or "")


def _call_anthropic(user_content: str) -> str:
    s = _llm_settings()
    model = s["anthropic_model"]
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_content}],
    }
    # Opus 5 / Sonnet 5 reject non-default temperature/top_p/top_k (HTTP 400).
    if not _anthropic_uses_adaptive_thinking(model):
        body["temperature"] = 0.3
    else:
        body["output_config"] = {"effort": "low"}
        body["max_tokens"] = 8192
    with httpx.Client(timeout=90.0) as client:
        r = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": s["anthropic_key"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        if r.is_error:
            raise RuntimeError(f"Anthropic {r.status_code}: {_http_error_detail(r)}")
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
    s = _llm_settings()
    if provider == "openai":
        raw_text = _call_openai(user_content)
        model = s["openai_model"]
    else:
        raw_text = _call_anthropic(user_content)
        model = s["anthropic_model"]
    parsed = _extract_json(raw_text)
    return _normalize_advice(parsed, provider, model)
