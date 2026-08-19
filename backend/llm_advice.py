"""LLM investment advice — OpenAI or Anthropic via httpx."""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
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


FOLLOWUP_SYSTEM = """You are a disciplined US equity research analyst continuing an existing conversation.
You already gave a structured recommendation (JSON) for this ticker using quote, fundamentals, insiders, options, news, and macro context.
Answer follow-up questions in clear prose (not JSON). Stay consistent with that recommendation unless the user provides new facts.
If you change your mind, say so explicitly. Not financial advice; be explicit about uncertainty."""


_conv_lock = threading.Lock()
_conversations: dict[str, dict[str, Any]] = {}
MAX_CONVERSATIONS = 48
MAX_TURNS = 36


def _openai_complete(messages: list[dict[str, str]], system: str, *, json_mode: bool) -> str:
    s = _llm_settings()
    body: dict[str, Any] = {
        "model": s["openai_model"],
        "messages": [{"role": "system", "content": system}, *messages],
    }
    if json_mode:
        body["temperature"] = 0.3
        body["response_format"] = {"type": "json_object"}
    else:
        body["temperature"] = 0.4
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


def _anthropic_complete(messages: list[dict[str, str]], system: str, *, json_mode: bool) -> str:
    s = _llm_settings()
    model = s["anthropic_model"]
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "system": system,
        "messages": messages,
    }
    if json_mode:
        extra = " Respond with JSON only, no markdown fences."
        body["system"] = system + extra
    if not _anthropic_uses_adaptive_thinking(model):
        body["temperature"] = 0.3 if json_mode else 0.4
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


def _complete(
    messages: list[dict[str, str]], system: str, *, json_mode: bool = False
) -> tuple[str, str, str]:
    provider = _pick_provider()
    s = _llm_settings()
    if provider == "openai":
        text = _openai_complete(messages, system, json_mode=json_mode)
        return text, provider, s["openai_model"]
    text = _anthropic_complete(messages, system, json_mode=json_mode)
    return text, provider, s["anthropic_model"]


def _call_openai(user_content: str, system: str = SYSTEM_PROMPT) -> str:
    return _openai_complete([{"role": "user", "content": user_content}], system, json_mode=True)


def _call_anthropic(user_content: str, system: str = SYSTEM_PROMPT) -> str:
    return _anthropic_complete([{"role": "user", "content": user_content}], system, json_mode=True)


def _prune_conversations() -> None:
    if len(_conversations) <= MAX_CONVERSATIONS:
        return
    oldest = sorted(_conversations.items(), key=lambda kv: int(kv[1].get("updated_at") or 0))
    for cid, _ in oldest[: len(_conversations) - MAX_CONVERSATIONS]:
        _conversations.pop(cid, None)


def _public_messages(conv: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in conv.get("messages") or []:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        kind = m.get("kind") or "text"
        if kind == "context":
            continue
        item: dict[str, Any] = {"role": role, "kind": kind, "content": m.get("content") or ""}
        if m.get("advice"):
            item["advice"] = m["advice"]
        out.append(item)
    return out


def _trim_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(messages) <= MAX_TURNS:
        return messages
    head = messages[:2]
    tail = messages[-(MAX_TURNS - 2) :]
    if tail and tail[0].get("role") == "assistant":
        tail = tail[1:]
    return head + tail


def start_research_conversation(symbol: str, context: dict[str, Any]) -> dict[str, Any]:
    symbol = symbol.strip().upper()
    user_content = (
        "Analyze the following market context and return JSON per the schema.\n\n"
        + json.dumps(context, indent=2, default=str)
    )
    raw_text, provider, model = _complete(
        [{"role": "user", "content": user_content}],
        SYSTEM_PROMPT,
        json_mode=True,
    )
    advice = _normalize_advice(_extract_json(raw_text), provider, model)
    cid = uuid.uuid4().hex[:16]
    now = int(time.time())
    conv = {
        "id": cid,
        "kind": "research",
        "symbol": symbol,
        "created_at": now,
        "updated_at": now,
        "provider": provider,
        "model": model,
        "messages": [
            {"role": "user", "content": user_content, "kind": "context"},
            {
                "role": "assistant",
                "content": json.dumps(advice, indent=2, default=str),
                "kind": "advice",
                "advice": advice,
            },
        ],
        "advice": advice,
    }
    with _conv_lock:
        _conversations[cid] = conv
        _prune_conversations()
    return {
        "conversation_id": cid,
        "symbol": symbol,
        "advice": advice,
        "messages": _public_messages(conv),
        "context_as_of": context.get("as_of"),
    }


def follow_up_research_conversation(conversation_id: str, symbol: str, message: str) -> dict[str, Any]:
    text = (message or "").strip()
    if not text:
        raise ValueError("Message is empty")
    if len(text) > 4000:
        raise ValueError("Message is too long")
    symbol = symbol.strip().upper()
    with _conv_lock:
        conv = _conversations.get(conversation_id)
        if not conv:
            raise KeyError("Conversation not found")
        if conv.get("symbol") != symbol:
            raise ValueError("Conversation is for a different symbol")
        history = list(conv.get("messages") or [])

    api_messages = [{"role": m["role"], "content": m["content"]} for m in history if m.get("role") in ("user", "assistant")]
    api_messages.append({"role": "user", "content": text})
    api_messages = _trim_messages(api_messages)
    raw_text, provider, model = _complete(api_messages, FOLLOWUP_SYSTEM, json_mode=False)
    reply = raw_text.strip()
    now = int(time.time())
    with _conv_lock:
        conv = _conversations.get(conversation_id)
        if not conv:
            raise KeyError("Conversation not found")
        conv.setdefault("messages", []).append({"role": "user", "content": text, "kind": "text"})
        conv["messages"].append({"role": "assistant", "content": reply, "kind": "text"})
        conv["messages"] = _trim_messages(conv["messages"])
        conv["updated_at"] = now
        conv["provider"] = provider
        conv["model"] = model
        public = _public_messages(conv)
        advice = conv.get("advice")
    return {
        "conversation_id": conversation_id,
        "symbol": symbol,
        "advice": advice,
        "reply": reply,
        "messages": public,
    }


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


PORTFOLIO_SYSTEM_PROMPT = """You are a disciplined US equity portfolio reviewer for a paper (simulated) stock fund.
The fund can hold shares of US stocks and ETFs only — no options, no crypto, no shorts beyond selling existing shares.

Given JSON for fund NAV, cash, holdings (weights, P/L, RSI, daily TA, headlines) and macro (SPY, QQQ, VIX), produce ONE review.

Allowed overall stance (pick exactly one):
- ADD RISK — put idle cash to work or add to winners with room
- HOLD — keep the book; no urgent change
- REDUCE RISK — trim concentrated or extended names, raise cash
- REBALANCE — mix of trims and adds to fix weights / style drift

Position actions: HOLD, ADD, TRIM, EXIT (shares only).

Respond with JSON only (no markdown fences), schema:
{
  "stance": "ADD RISK" | "HOLD" | "REDUCE RISK" | "REBALANCE",
  "confidence": "high" | "medium" | "low",
  "thesis": "2-4 sentences on the book as a whole",
  "suggestions": [
    {"symbol": "AAPL", "action": "HOLD"|"ADD"|"TRIM"|"EXIT", "note": "one sentence"}
  ],
  "reasons": ["bullet 1", "bullet 2"],
  "risks": ["risk 1", "risk 2"],
  "time_horizon": "days" | "weeks" | "months"
}
Cover every holding. Not financial advice; be explicit when data is thin."""


VALID_STANCES = {"ADD RISK", "HOLD", "REDUCE RISK", "REBALANCE"}
VALID_POSITION_ACTIONS = {"HOLD", "ADD", "TRIM", "EXIT"}


def _normalize_portfolio_advice(raw: dict[str, Any], provider: str, model: str) -> dict[str, Any]:
    stance = str(raw.get("stance") or "HOLD").upper().strip()
    stance = stance.replace("_", " ")
    if stance not in VALID_STANCES:
        for candidate in VALID_STANCES:
            if candidate in stance:
                stance = candidate
                break
        else:
            stance = "HOLD"
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
    suggestions: list[dict[str, str]] = []
    for row in raw.get("suggestions") or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().split(":")[-1]
        action = str(row.get("action") or "HOLD").upper().strip()
        if action not in VALID_POSITION_ACTIONS:
            action = "HOLD"
        note = str(row.get("note") or "").strip()
        if sym:
            suggestions.append({"symbol": sym, "action": action, "note": note})
    return {
        "stance": stance,
        "confidence": conf,
        "thesis": str(raw.get("thesis") or "").strip(),
        "suggestions": suggestions,
        "reasons": reasons,
        "risks": risks,
        "time_horizon": horizon,
        "provider": provider,
        "model": model,
        "disclaimer": "Vibe-style paper-portfolio review, not financial advice. You can lose money.",
    }


def generate_portfolio_advice(context: dict[str, Any]) -> dict[str, Any]:
    provider = _pick_provider()
    user_content = (
        "Review this paper stock portfolio and return JSON per the schema.\n\n"
        + json.dumps(context, indent=2, default=str)
    )
    s = _llm_settings()
    if provider == "openai":
        raw_text = _call_openai(user_content, PORTFOLIO_SYSTEM_PROMPT)
        model = s["openai_model"]
    else:
        raw_text = _call_anthropic(user_content, PORTFOLIO_SYSTEM_PROMPT)
        model = s["anthropic_model"]
    parsed = _extract_json(raw_text)
    return _normalize_portfolio_advice(parsed, provider, model)


PORTFOLIO_FOLLOWUP_SYSTEM = """You are a disciplined US equity portfolio reviewer continuing an existing conversation about a paper (simulated) stock fund.
You already gave a structured review (JSON) with an overall stance (ADD RISK / HOLD / REDUCE RISK / REBALANCE) and HOLD / ADD / TRIM / EXIT notes on share positions. The fund cannot hold options, crypto, or shorts beyond selling existing shares.
Answer follow-up questions in clear prose (not JSON). Stay consistent with that review unless the user provides new facts.
If you change your mind, say so explicitly. Not financial advice; be explicit about uncertainty."""


def start_portfolio_conversation(portfolio_id: str, context: dict[str, Any]) -> dict[str, Any]:
    pid = (portfolio_id or "").strip()
    if not pid:
        raise ValueError("portfolio_id is required")
    user_content = (
        "Review this paper stock portfolio and return JSON per the schema.\n\n"
        + json.dumps(context, indent=2, default=str)
    )
    raw_text, provider, model = _complete(
        [{"role": "user", "content": user_content}],
        PORTFOLIO_SYSTEM_PROMPT,
        json_mode=True,
    )
    advice = _normalize_portfolio_advice(_extract_json(raw_text), provider, model)
    cid = uuid.uuid4().hex[:16]
    now = int(time.time())
    conv = {
        "id": cid,
        "kind": "portfolio",
        "portfolio_id": pid,
        "created_at": now,
        "updated_at": now,
        "provider": provider,
        "model": model,
        "messages": [
            {"role": "user", "content": user_content, "kind": "context"},
            {
                "role": "assistant",
                "content": json.dumps(advice, indent=2, default=str),
                "kind": "advice",
                "advice": advice,
            },
        ],
        "advice": advice,
    }
    with _conv_lock:
        _conversations[cid] = conv
        _prune_conversations()
    return {
        "conversation_id": cid,
        "portfolio_id": pid,
        "advice": advice,
        "messages": _public_messages(conv),
        "context_as_of": context.get("as_of"),
    }


def follow_up_portfolio_conversation(conversation_id: str, portfolio_id: str, message: str) -> dict[str, Any]:
    text = (message or "").strip()
    if not text:
        raise ValueError("Message is empty")
    if len(text) > 4000:
        raise ValueError("Message is too long")
    pid = (portfolio_id or "").strip()
    with _conv_lock:
        conv = _conversations.get(conversation_id)
        if not conv:
            raise KeyError("Conversation not found")
        if conv.get("kind") != "portfolio" or conv.get("portfolio_id") != pid:
            raise ValueError("Conversation is for a different portfolio")
        history = list(conv.get("messages") or [])

    api_messages = [{"role": m["role"], "content": m["content"]} for m in history if m.get("role") in ("user", "assistant")]
    api_messages.append({"role": "user", "content": text})
    api_messages = _trim_messages(api_messages)
    raw_text, provider, model = _complete(api_messages, PORTFOLIO_FOLLOWUP_SYSTEM, json_mode=False)
    reply = raw_text.strip()
    now = int(time.time())
    with _conv_lock:
        conv = _conversations.get(conversation_id)
        if not conv:
            raise KeyError("Conversation not found")
        conv.setdefault("messages", []).append({"role": "user", "content": text, "kind": "text"})
        conv["messages"].append({"role": "assistant", "content": reply, "kind": "text"})
        conv["messages"] = _trim_messages(conv["messages"])
        conv["updated_at"] = now
        conv["provider"] = provider
        conv["model"] = model
        public = _public_messages(conv)
        advice = conv.get("advice")
    return {
        "conversation_id": conversation_id,
        "portfolio_id": pid,
        "advice": advice,
        "reply": reply,
        "messages": public,
    }
