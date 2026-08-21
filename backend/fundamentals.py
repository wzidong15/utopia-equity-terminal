"""Yahoo financial statements and EPS surprise (Bloomberg FA / EE lite)."""

from __future__ import annotations

import math
from typing import Any, Callable

import pandas as pd

CleanFn = Callable[[Any], Any]
UnixFn = Callable[[dict[str, Any]], int | None]

INCOME_ROWS = {
    "revenue": ["Total Revenue", "Operating Revenue"],
    "gross_profit": ["Gross Profit"],
    "operating_income": ["Operating Income", "Operating Income Loss"],
    "net_income": ["Net Income", "Net Income Common Stockholders"],
    "eps": ["Diluted EPS", "Basic EPS", "Diluted EPS Other Gains Losses"],
}
BALANCE_ROWS = {
    "cash": [
        "Cash And Cash Equivalents",
        "Cash Cash Equivalents And Short Term Investments",
        "Cash Financial",
    ],
    "total_debt": ["Total Debt"],
    "equity": ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"],
    "total_assets": ["Total Assets"],
}
CASH_ROWS = {
    "operating_cf": ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
    "capex": ["Capital Expenditure", "Purchase Of PPE"],
    "fcf": ["Free Cash Flow"],
}


def _idx_map(df: pd.DataFrame) -> dict[str, Any]:
    return {str(i).strip().lower(): i for i in df.index}


def _cell(df: pd.DataFrame, names: list[str], col: Any, clean: CleanFn) -> Any:
    lookup = _idx_map(df)
    for name in names:
        orig = lookup.get(name.strip().lower())
        if orig is not None:
            try:
                return clean(df.loc[orig, col])
            except Exception:
                continue
    return None


def _period_label(col: Any, *, annual: bool) -> str:
    try:
        ts = pd.Timestamp(col)
        if pd.isna(ts):
            return str(col)[:10]
        if annual:
            return f"FY{ts.year}"
        return f"{ts.year} Q{int(ts.quarter)}"
    except Exception:
        return str(col)[:10]


def _statement(
    df: pd.DataFrame | None,
    rows: dict[str, list[str]],
    clean: CleanFn,
    *,
    annual: bool,
    limit: int = 4,
) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    cols = list(df.columns)[:limit]
    out: list[dict[str, Any]] = []
    for col in cols:
        item: dict[str, Any] = {"period": _period_label(col, annual=annual)}
        for key, names in rows.items():
            item[key] = _cell(df, names, col, clean)
        if item.get("fcf") is None and item.get("operating_cf") is not None:
            capex = item.get("capex")
            if isinstance(item["operating_cf"], (int, float)):
                extra = capex if isinstance(capex, (int, float)) else 0.0
                item["fcf"] = item["operating_cf"] + extra
        out.append(item)
    return out


def _sum_flow(quarters: list[dict[str, Any]], keys: list[str]) -> dict[str, Any]:
    item: dict[str, Any] = {"period": "TTM"}
    for key in keys:
        total = 0.0
        n = 0
        for q in quarters[:4]:
            v = q.get(key)
            if isinstance(v, (int, float)) and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                total += float(v)
                n += 1
        item[key] = round(total, 6) if n else None
    return item


def _earnings_history(ticker: Any, clean: CleanFn, limit: int = 8) -> list[dict[str, Any]]:
    df = None
    try:
        df = ticker.get_earnings_dates(limit=limit)
    except Exception:
        try:
            df = ticker.earnings_dates
        except Exception:
            df = None
    if df is None or getattr(df, "empty", True):
        return []
    colmap = {str(c).strip().lower(): c for c in df.columns}

    def col(*names: str):
        for n in names:
            if n in colmap:
                return colmap[n]
        return None

    est_c = col("eps estimate", "eps estimate")
    act_c = col("reported eps", "actual")
    sur_c = col("surprise(%)", "surprise %", "surprise")
    rows: list[dict[str, Any]] = []
    for idx, row in df.iterrows():
        ts = None
        try:
            t = pd.Timestamp(idx)
            if t.tzinfo is None:
                ts = int(t.timestamp())
            else:
                ts = int(t.tz_convert("UTC").timestamp())
        except Exception:
            ts = None
        est = clean(row[est_c]) if est_c is not None else None
        act = clean(row[act_c]) if act_c is not None else None
        surprise = clean(row[sur_c]) if sur_c is not None else None
        if surprise is None and isinstance(est, (int, float)) and isinstance(act, (int, float)) and est != 0:
            surprise = (act - est) / abs(est) * 100.0
        rows.append(
            {
                "at": ts,
                "period": _period_label(idx, annual=False),
                "estimate": est,
                "actual": act,
                "surprise_pct": surprise,
            }
        )
    return rows


def build_fundamentals(
    symbol: str,
    ticker: Any,
    info: dict[str, Any],
    clean: CleanFn,
    next_earnings_unix: UnixFn,
) -> dict[str, Any]:
    income_a = _statement(getattr(ticker, "income_stmt", None), INCOME_ROWS, clean, annual=True)
    income_q = _statement(getattr(ticker, "quarterly_income_stmt", None), INCOME_ROWS, clean, annual=False)
    balance_a = _statement(getattr(ticker, "balance_sheet", None), BALANCE_ROWS, clean, annual=True)
    balance_q = _statement(getattr(ticker, "quarterly_balance_sheet", None), BALANCE_ROWS, clean, annual=False)
    cash_a = _statement(getattr(ticker, "cashflow", None), CASH_ROWS, clean, annual=True)
    cash_q = _statement(getattr(ticker, "quarterly_cashflow", None), CASH_ROWS, clean, annual=False)

    ttm_income = _sum_flow(income_q, ["revenue", "gross_profit", "operating_income", "net_income"]) if income_q else None
    if ttm_income is not None:
        ttm_income["eps"] = clean(info.get("trailingEps"))
    ttm_cash = _sum_flow(cash_q, ["operating_cf", "capex", "fcf"]) if cash_q else None

    income = ([ttm_income] if ttm_income and ttm_income.get("revenue") is not None else []) + income_a
    cash = ([ttm_cash] if ttm_cash and (ttm_cash.get("operating_cf") is not None or ttm_cash.get("fcf") is not None) else []) + cash_a
    balance = (balance_q[:1] if balance_q else []) + balance_a

    fcf = clean(info.get("freeCashflow"))
    debt = clean(info.get("totalDebt"))
    cash_bal = clean(info.get("totalCash"))
    net_debt = None
    if isinstance(debt, (int, float)) or isinstance(cash_bal, (int, float)):
        net_debt = (debt or 0) - (cash_bal or 0)
    if fcf is None and cash:
        fcf = cash[0].get("fcf")

    def _pct(v: Any) -> Any:
        n = clean(v)
        if not isinstance(n, (int, float)):
            return None
        return n * 100.0 if abs(n) <= 1.5 else n

    history = _earnings_history(ticker, clean)
    now = pd.Timestamp.utcnow().timestamp()
    reported = [r for r in history if r.get("actual") is not None][:4]
    upcoming = next((r for r in history if r.get("at") and r["at"] >= now - 12 * 3600 and r.get("actual") is None), None)

    return {
        "symbol": symbol,
        "source": "yfinance",
        "next_earnings_at": next_earnings_unix(info),
        "upcoming": upcoming,
        "ratios": {
            "gross_margin": _pct(info.get("grossMargins")),
            "fcf": fcf,
            "net_debt": net_debt,
            "roe": _pct(info.get("returnOnEquity")),
            "operating_margin": _pct(info.get("operatingMargins")),
        },
        "income": income[:5],
        "balance": balance[:5],
        "cashflow": cash[:5],
        "earnings": reported,
    }
