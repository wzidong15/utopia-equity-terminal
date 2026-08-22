"""Yahoo ownership, short interest, and SEC filings."""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

CleanFn = Callable[[Any], Any]

FILING_TYPES = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A"}


def _frac(clean: CleanFn, v: Any) -> Any:
    n = clean(v)
    if not isinstance(n, (int, float)):
        return None
    return n * 100.0 if abs(n) <= 1.5 else n


def _iso_date(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if hasattr(v, "isoformat"):
            return str(v.isoformat())[:10]
        ts = pd.Timestamp(v)
        if pd.isna(ts):
            return None
        return str(ts.date())
    except Exception:
        s = str(v).strip()
        return s[:10] if s else None


def _unix(v: Any) -> int | None:
    n = v
    try:
        if hasattr(v, "timestamp"):
            n = v.timestamp()
        n = float(n)
    except Exception:
        return None
    if n > 1e12:
        n = n / 1000.0
    if n < 1e9:
        return None
    return int(n)


def _filing_url(item: dict[str, Any], ftype: str) -> str | None:
    ex = item.get("exhibits") or {}
    if isinstance(ex, dict):
        stem = ftype.split("/")[0]
        for key in (ftype, stem, "EX-99.1"):
            u = ex.get(key)
            if u:
                return str(u)
    for key in ("edgarUrl", "url", "link"):
        u = item.get(key)
        if u:
            return str(u)
    return None


def _filings(ticker: Any, limit: int = 12) -> list[dict[str, Any]]:
    raw = None
    try:
        raw = ticker.get_sec_filings()
    except Exception:
        try:
            raw = ticker.sec_filings
        except Exception:
            raw = None
    if not raw:
        return []
    items = raw if isinstance(raw, list) else list(raw)
    matched: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ftype = str(item.get("type") or "").upper().strip()
        if ftype not in FILING_TYPES:
            continue
        matched.append(
            {
                "type": ftype,
                "title": item.get("title") or ftype,
                "date": _iso_date(item.get("date") or item.get("epochDate")),
                "url": _filing_url(item, ftype),
            }
        )
    out = matched[:12]
    latest_k = next((row for row in matched if row["type"].startswith("10-K")), None)
    if latest_k and latest_k not in out:
        out = [*out[:11], latest_k]
        out.sort(key=lambda r: r.get("date") or "", reverse=True)
    return out


def _holders(ticker: Any, clean: CleanFn, limit: int = 8) -> list[dict[str, Any]]:
    df = None
    try:
        df = ticker.get_institutional_holders()
    except Exception:
        try:
            df = ticker.institutional_holders
        except Exception:
            df = None
    if df is None or getattr(df, "empty", True):
        return []
    colmap = {str(c).strip().lower().replace(" ", ""): c for c in df.columns}

    def col(*names: str) -> Any:
        for n in names:
            key = n.strip().lower().replace(" ", "")
            if key in colmap:
                return colmap[key]
        return None

    name_c = col("holder", "organization")
    shares_c = col("shares", "position")
    value_c = col("value")
    pct_c = col("pctheld", "%out", "percent")
    chg_c = col("pctchange")
    date_c = col("datereported", "date")
    rows: list[dict[str, Any]] = []
    for _, row in df.head(limit).iterrows():
        name = row[name_c] if name_c is not None else None
        rows.append(
            {
                "name": None if name is None or (isinstance(name, float) and pd.isna(name)) else str(name),
                "shares": clean(row[shares_c]) if shares_c is not None else None,
                "value": clean(row[value_c]) if value_c is not None else None,
                "pct_held": _frac(clean, row[pct_c]) if pct_c is not None else None,
                "pct_change": _frac(clean, row[chg_c]) if chg_c is not None else None,
                "as_of": _iso_date(row[date_c]) if date_c is not None else None,
            }
        )
    return rows


def build_ownership(symbol: str, ticker: Any, info: dict[str, Any], clean: CleanFn) -> dict[str, Any]:
    short_pct = _frac(clean, info.get("shortPercentOfFloat"))
    return {
        "symbol": symbol,
        "source": "yfinance",
        "beta": clean(info.get("beta")),
        "float": clean(info.get("floatShares")),
        "shares_out": clean(info.get("sharesOutstanding")),
        "short_shares": clean(info.get("sharesShort")),
        "short_pct_float": short_pct,
        "short_ratio": clean(info.get("shortRatio")),
        "short_prior": clean(info.get("sharesShortPriorMonth")),
        "short_as_of": _unix(info.get("dateShortInterest")),
        "insider_pct": _frac(clean, info.get("heldPercentInsiders")),
        "inst_pct": _frac(clean, info.get("heldPercentInstitutions")),
        "holders": _holders(ticker, clean),
        "filings": _filings(ticker),
    }
