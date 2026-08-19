"""Paper-portfolio review using the same US research stack as Vibe-Trading MCP.

Vibe-Trading MCP (technical_indicators, get_stock_news, get_stock_profile) is Yahoo /
TradingView TA for US names with no extra key. This module gathers that pack for a
simulated fund, then asks the configured LLM for HOLD/ADD/TRIM/EXIT notes. If no LLM
key is set, a RSI/TA/concentration heuristic still returns suggestions.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

import llm_advice

MAX_NAMES = 6


def _weight(mv: float, nav: float) -> float:
    if not nav:
        return 0.0
    return round(100.0 * mv / nav, 2)


def _heuristic_action(rsi: float | None, label: str | None, weight: float, pnl: float | None) -> tuple[str, str]:
    rec = (label or "").upper()
    if rsi is not None and rsi >= 72:
        return "TRIM", f"RSI {rsi:.0f} is extended"
    if rsi is not None and rsi <= 30:
        return "ADD", f"RSI {rsi:.0f} is oversold"
    if weight >= 35:
        return "TRIM", f"Position is {weight:.0f}% of NAV"
    if "STRONG SELL" in rec or rec.endswith("SELL"):
        return "TRIM", f"Daily TA {label}"
    if "STRONG BUY" in rec and (pnl is None or pnl >= 0):
        return "ADD", f"Daily TA {label}"
    return "HOLD", "No urgent technical flag"


def _heuristic_review(ctx: dict[str, Any]) -> dict[str, Any]:
    names = ctx.get("holdings") or []
    cash_w = float(ctx.get("cash_weight_pct") or 0)
    top_w = float(ctx.get("top_weight_pct") or 0)
    suggestions = []
    add = trim = 0
    for h in names:
        action, note = _heuristic_action(h.get("rsi"), h.get("ta_label"), float(h.get("weight_pct") or 0), h.get("unrealized_pnl"))
        if action == "ADD":
            add += 1
        if action in ("TRIM", "EXIT"):
            trim += 1
        suggestions.append({"symbol": h["symbol"], "action": action, "note": note})
    if not names and cash_w >= 80:
        stance = "ADD RISK"
        thesis = "The fund is mostly cash. Consider a first share purchase if you have a thesis."
    elif top_w >= 40 or trim > add:
        stance = "REDUCE RISK"
        thesis = "Concentration or extended technicals argue for trims rather than new risk."
    elif add > trim and cash_w >= 15:
        stance = "ADD RISK"
        thesis = "Oversold or constructive TA on some names, with cash available to add shares."
    elif add and trim:
        stance = "REBALANCE"
        thesis = "Mix of stretched and oversold names — rebalance rather than change overall risk much."
    else:
        stance = "HOLD"
        thesis = "No sharp technical or concentration flag on the current book."
    reasons = [
        f"Cash is {cash_w:.1f}% of NAV.",
        f"Largest holding is {top_w:.1f}% of NAV." if names else "No share positions yet.",
    ]
    return {
        "stance": stance,
        "confidence": "low",
        "thesis": thesis,
        "suggestions": suggestions,
        "reasons": reasons,
        "risks": ["Heuristic only — no LLM. Treat as a checklist, not a recommendation."],
        "time_horizon": "weeks",
        "provider": "heuristic",
        "model": "rsi-ta-weights",
        "disclaimer": "Vibe-style paper-portfolio review, not financial advice. You can lose money.",
    }


def _one_name(
    h: dict[str, Any],
    nav: float,
    quote_fn: Callable[[str], dict[str, Any]],
    ta_fn: Callable[[str], dict[str, Any]],
    news_fn: Callable[[str], list[dict[str, Any]]],
) -> dict[str, Any]:
    sym = str(h.get("symbol") or "").upper()
    mv = float(h.get("market_value") or 0)
    row: dict[str, Any] = {
        "symbol": sym,
        "shares": h.get("shares"),
        "avg_cost": h.get("avg_cost"),
        "last_price": h.get("last_price"),
        "market_value": mv,
        "unrealized_pnl": h.get("unrealized_pnl"),
        "weight_pct": _weight(mv, nav),
    }
    try:
        q = quote_fn(sym) or {}
        row["rsi"] = q.get("rsi")
        row["change_pct"] = q.get("change_pct")
        row["recommend_label"] = q.get("recommend_label")
        row["session"] = q.get("session")
        row["delay"] = q.get("delay")
    except Exception as e:
        row["quote_error"] = str(e)
    try:
        tadata = ta_fn(sym) or {}
        summary = tadata.get("summary") or {}
        indicators = tadata.get("indicators") or {}
        row["ta_label"] = summary.get("RECOMMENDATION") or row.get("recommend_label")
        row["ta_buy"] = summary.get("BUY")
        row["ta_sell"] = summary.get("SELL")
        if row.get("rsi") is None:
            row["rsi"] = indicators.get("RSI")
        row["sma20"] = indicators.get("SMA20") or indicators.get("SMA20")
        row["sma50"] = indicators.get("SMA50")
    except Exception as e:
        row["ta_error"] = str(e)
    try:
        headlines = news_fn(sym) or []
        row["headlines"] = [
            {"title": n.get("title"), "publisher": n.get("publisher")} for n in headlines[:3] if n.get("title")
        ]
    except Exception:
        row["headlines"] = []
    return row


def build_research(
    portfolio: dict[str, Any],
    *,
    quote_fn: Callable[[str], dict[str, Any]],
    ta_fn: Callable[[str], dict[str, Any]],
    news_fn: Callable[[str], list[dict[str, Any]]],
    macro_fn: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    nav = float(portfolio.get("nav") or 0)
    cash = float(portfolio.get("cash") or 0)
    holdings = list(portfolio.get("holdings") or [])[:MAX_NAMES]
    names: list[dict[str, Any]] = []
    if holdings:
        with ThreadPoolExecutor(max_workers=min(6, len(holdings))) as pool:
            futs = [pool.submit(_one_name, h, nav, quote_fn, ta_fn, news_fn) for h in holdings]
            for fut in as_completed(futs):
                names.append(fut.result())
        names.sort(key=lambda x: -(x.get("weight_pct") or 0))
    top_w = max((n.get("weight_pct") or 0) for n in names) if names else 0.0
    try:
        macro = macro_fn() or {}
    except Exception as e:
        macro = {"error": str(e)}
    return {
        "as_of": int(time.time()),
        "stack": "Vibe-Trading US MCP analogue: Yahoo quotes/news + TradingView daily TA",
        "fund": {
            "id": portfolio.get("id"),
            "name": portfolio.get("name"),
            "nav": nav,
            "cash": cash,
            "pnl": portfolio.get("pnl"),
            "return_pct": portfolio.get("return_pct"),
            "max_drawdown_pct": portfolio.get("max_drawdown_pct"),
            "strategy": (portfolio.get("strategy") or {}).get("kind"),
            "mark_session": portfolio.get("mark_session"),
        },
        "cash_weight_pct": _weight(cash, nav) if nav else 100.0,
        "top_weight_pct": top_w,
        "holdings": names,
        "macro_market": {k: macro.get(k) for k in ("SPY", "QQQ", "VIX") if k in (macro or {})},
    }


def review(research: dict[str, Any]) -> dict[str, Any]:
    if llm_advice.llm_configured()["any"]:
        try:
            advice = llm_advice.generate_portfolio_advice(research)
            return {"advice": advice, "engine": "llm"}
        except Exception as e:
            fallback = _heuristic_review(research)
            fallback["llm_error"] = str(e)
            return {"advice": fallback, "engine": "heuristic"}
    return {"advice": _heuristic_review(research), "engine": "heuristic"}
