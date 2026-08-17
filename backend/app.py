"""US equity terminal API.

Free sources (same stack as the TradingView / Vibe-Trading MCPs):
  - TradingView scanner  -> live-ish quotes, movers, ratings (delayed ~15m unsigned)
  - Yahoo Finance        -> OHLCV candles, company profile, news
"""

from __future__ import annotations

import math
import os
import time
from functools import lru_cache
from typing import Any, Literal

import httpx
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query as Q
from fastapi.middleware.cors import CORSMiddleware
from tradingview_screener import Query, col
from tradingview_ta import Interval, TA_Handler

POLYGON_KEY = os.environ.get("POLYGON_API_KEY") or os.environ.get("MASSIVE_API_KEY") or ""
POLYGON_BASE = os.environ.get("MASSIVE_API_BASE_URL") or "https://api.polygon.io"

app = FastAPI(title="Utopia US Equity Terminal", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

INDEX_TICKERS = {
    "SPY": "AMEX:SPY",
    "QQQ": "NASDAQ:QQQ",
    "DIA": "AMEX:DIA",
    "IWM": "AMEX:IWM",
    "VIX": "CBOE:VIX",
}

QUOTE_COLS = [
    "name",
    "description",
    "close",
    "change",
    "change_abs",
    "open",
    "high",
    "low",
    "volume",
    "average_volume_30d_calc",
    "market_cap_basic",
    "price_earnings_ttm",
    "earnings_per_share_basic_ttm",
    "dividend_yield_recent",
    "High.1Y",
    "Low.1Y",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "Perf.Y",
    "RSI",
    "Recommend.All",
    "Recommend.MA",
    "Recommend.Other",
    "SMA20",
    "SMA50",
    "SMA200",
    "MACD.macd",
    "MACD.signal",
    "sector",
    "industry",
    "exchange",
    "type",
    "is_primary",
]

RANGE_TO_YF = {
    "1d": ("1d", "1m"),
    "5d": ("5d", "5m"),
    "1mo": ("1mo", "30m"),
    "3mo": ("3mo", "1d"),
    "6mo": ("6mo", "1d"),
    "1y": ("1y", "1d"),
    "5y": ("5y", "1wk"),
}

_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value


def _clean(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (float, int)) and (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    if pd.isna(v):
        return None
    if hasattr(v, "item"):
        try:
            return _clean(v.item())
        except Exception:
            return str(v)
    return v


def _row_to_quote(row: pd.Series) -> dict[str, Any]:
    ticker = str(row.get("ticker") or "")
    symbol = str(row.get("name") or ticker.split(":")[-1])
    rec = _clean(row.get("Recommend.All"))
    rec_label = None
    if rec is not None:
        if rec >= 0.5:
            rec_label = "STRONG BUY"
        elif rec >= 0.1:
            rec_label = "BUY"
        elif rec > -0.1:
            rec_label = "NEUTRAL"
        elif rec > -0.5:
            rec_label = "SELL"
        else:
            rec_label = "STRONG SELL"
    return {
        "ticker": ticker,
        "symbol": symbol,
        "name": _clean(row.get("description")) or symbol,
        "exchange": _clean(row.get("exchange")) or (ticker.split(":")[0] if ":" in ticker else None),
        "price": _clean(row.get("close")),
        "change_pct": _clean(row.get("change")),
        "change": _clean(row.get("change_abs")),
        "open": _clean(row.get("open")),
        "high": _clean(row.get("high")),
        "low": _clean(row.get("low")),
        "volume": _clean(row.get("volume")),
        "avg_volume": _clean(row.get("average_volume_30d_calc")),
        "market_cap": _clean(row.get("market_cap_basic")),
        "pe": _clean(row.get("price_earnings_ttm")),
        "eps": _clean(row.get("earnings_per_share_basic_ttm")),
        "dividend_yield": _clean(row.get("dividend_yield_recent")),
        "year_high": _clean(row.get("High.1Y")),
        "year_low": _clean(row.get("Low.1Y")),
        "perf_w": _clean(row.get("Perf.W")),
        "perf_1m": _clean(row.get("Perf.1M")),
        "perf_3m": _clean(row.get("Perf.3M")),
        "perf_y": _clean(row.get("Perf.Y")),
        "rsi": _clean(row.get("RSI")),
        "sma20": _clean(row.get("SMA20")),
        "sma50": _clean(row.get("SMA50")),
        "sma200": _clean(row.get("SMA200")),
        "macd": _clean(row.get("MACD.macd")),
        "macd_signal": _clean(row.get("MACD.signal")),
        "recommend": rec,
        "recommend_label": rec_label,
        "recommend_ma": _clean(row.get("Recommend.MA")),
        "recommend_os": _clean(row.get("Recommend.Other")),
        "sector": _clean(row.get("sector")),
        "industry": _clean(row.get("industry")),
        "source": "tradingview-screener",
        "delay": "delayed_streaming_900",
        "as_of": int(time.time()),
    }


def _tv_query(tickers: list[str] | None = None, extra_where=None, order=None, limit=50) -> pd.DataFrame:
    q = Query().select(*QUOTE_COLS).set_markets("america")
    if tickers:
        q = q.set_tickers(*tickers)
    filters = []
    if extra_where:
        filters.extend(extra_where)
    if filters:
        q = q.where(*filters)
    if order:
        q = q.order_by(*order) if isinstance(order, tuple) else q.order_by(order)
    q = q.limit(limit)
    _, df = q.get_scanner_data()
    if df is None or df.empty:
        return pd.DataFrame()
    return df


@lru_cache(maxsize=512)
def resolve_tv_ticker(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if ":" in symbol:
        return symbol
    if symbol in INDEX_TICKERS:
        return INDEX_TICKERS[symbol]
    try:
        _, df = (
            Query()
            .select("name", "exchange", "type", "is_primary", "market_cap_basic")
            .set_markets("america")
            .where(col("name") == symbol)
            .limit(20)
            .get_scanner_data()
        )
    except Exception as e:
        raise HTTPException(502, f"TradingView lookup failed: {e}") from e
    if df is None or df.empty:
        raise HTTPException(404, f"Unknown symbol {symbol}")
    primary = df[df["is_primary"] == True] if "is_primary" in df.columns else df  # noqa: E712
    if primary.empty:
        primary = df
    stocks = primary[primary.get("type", "stock") == "stock"] if "type" in primary.columns else primary
    pick = stocks.iloc[0] if not stocks.empty else primary.iloc[0]
    return str(pick["ticker"])


def _yahoo_quote(symbol: str) -> dict[str, Any]:
    yf_sym = symbol.strip().upper().split(":")[-1]
    t = yf.Ticker("^VIX" if yf_sym == "VIX" else yf_sym)
    fi = t.fast_info
    price = _clean(getattr(fi, "last_price", None))
    prev = _clean(getattr(fi, "previous_close", None))
    change = (price - prev) if price is not None and prev else None
    change_pct = (change / prev * 100) if change is not None and prev else None
    return {
        "ticker": yf_sym,
        "symbol": yf_sym,
        "name": yf_sym,
        "exchange": _clean(getattr(fi, "exchange", None)),
        "price": price,
        "change_pct": change_pct,
        "change": change,
        "open": _clean(getattr(fi, "open", None)),
        "high": _clean(getattr(fi, "day_high", None)),
        "low": _clean(getattr(fi, "day_low", None)),
        "volume": _clean(getattr(fi, "last_volume", None)),
        "market_cap": _clean(getattr(fi, "market_cap", None)),
        "year_high": _clean(getattr(fi, "year_high", None)),
        "year_low": _clean(getattr(fi, "year_low", None)),
        "source": "yfinance",
        "delay": "yahoo",
        "as_of": int(time.time()),
    }


def _polygon_quote(symbol: str) -> dict[str, Any]:
    yf_sym = symbol.strip().upper().split(":")[-1]
    if yf_sym == "VIX":
        raise RuntimeError("VIX is not a Polygon stock ticker")
    url = f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{yf_sym}"
    with httpx.Client(timeout=8.0) as client:
        r = client.get(url, params={"apiKey": POLYGON_KEY})
        r.raise_for_status()
        body = r.json()
    t = body.get("ticker") or {}
    day = t.get("day") or {}
    prev = t.get("prevDay") or {}
    last = t.get("lastTrade") or {}
    price = _clean(last.get("p")) or _clean(day.get("c"))
    prev_close = _clean(prev.get("c"))
    change = _clean(t.get("todaysChange"))
    change_pct = _clean(t.get("todaysChangePerc"))
    return {
        "ticker": yf_sym,
        "symbol": yf_sym,
        "name": yf_sym,
        "exchange": None,
        "price": price,
        "change_pct": change_pct,
        "change": change,
        "open": _clean(day.get("o")),
        "high": _clean(day.get("h")),
        "low": _clean(day.get("l")),
        "volume": _clean(day.get("v")),
        "year_high": None,
        "year_low": None,
        "prev_close": prev_close,
        "source": "polygon",
        "delay": "realtime",
        "as_of": int(time.time()),
    }


def _best_quote(symbol: str) -> dict[str, Any]:
    if POLYGON_KEY:
        try:
            return _polygon_quote(symbol)
        except Exception:
            pass
    try:
        tv = resolve_tv_ticker(symbol)
        df = _tv_query([tv], limit=1)
        if not df.empty:
            return _row_to_quote(df.iloc[0])
    except Exception:
        pass
    return _yahoo_quote(symbol)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "polygon": bool(POLYGON_KEY),
        "sources": {
            "quotes": (
                "Polygon/Massive realtime"
                if POLYGON_KEY
                else "TradingView scanner (~15m delay) with Yahoo fallback"
            ),
            "charts": "Yahoo Finance / yfinance",
            "news": "Yahoo Finance",
        },
    }


@app.get("/api/indices")
def indices():
    def fetch():
        return [_best_quote(s) for s in INDEX_TICKERS]

    try:
        return {"items": _cached("indices", 8, fetch)}
    except Exception as e:
        raise HTTPException(502, f"Indices failed: {e}") from e


@app.get("/api/quote/{symbol}")
def quote(symbol: str):
    def fetch():
        return _best_quote(symbol)

    try:
        return _cached(f"quote:{symbol.upper()}", 5, fetch)
    except Exception as e:
        raise HTTPException(502, f"Quote failed: {e}") from e


@app.get("/api/quotes")
def quotes(symbols: str = Q(..., description="Comma-separated tickers")):
    raw = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "No symbols")
    def fetch():
        return [_best_quote(s) for s in raw[:40]]

    try:
        return {"items": _cached("quotes:" + ",".join(sorted(raw[:40])), 5, fetch)}
    except Exception as e:
        raise HTTPException(502, f"Quotes failed: {e}") from e


@app.get("/api/movers")
def movers(kind: Literal["gainers", "losers", "active"] = "gainers", limit: int = 15):
    limit = max(5, min(limit, 40))
    order = {
        "gainers": ("change", False),
        "losers": ("change", True),
        "active": ("volume", False),
    }[kind]

    def fetch():
        df = _tv_query(
            extra_where=[
                col("type") == "stock",
                col("is_primary") == True,  # noqa: E712
                col("exchange").isin(["NASDAQ", "NYSE", "AMEX"]),
                col("market_cap_basic") > 1_000_000_000,
                col("volume") > 200_000,
                col("close") > 5,
            ],
            order=order,  # (column, ascending)
            limit=limit,
        )
        return [_row_to_quote(r) for _, r in df.iterrows()]

    try:
        return {"kind": kind, "items": _cached(f"movers:{kind}:{limit}", 20, fetch)}
    except Exception as e:
        raise HTTPException(502, f"Movers failed: {e}") from e


@app.get("/api/search")
def search(q: str, limit: int = 12):
    q = q.strip()
    if len(q) < 1:
        return {"items": []}
    limit = max(1, min(limit, 25))

    def fetch():
        needle = q.upper()
        base = (
            Query()
            .select("name", "description", "exchange", "type", "close", "change", "market_cap_basic")
            .set_markets("america")
            .limit(limit)
        )
        _, df = (
            base.where(
                col("type").isin(["stock", "fund", "etf"]),
                col("is_primary") == True,  # noqa: E712
                col("name") == needle,
            ).get_scanner_data()
        )
        if df is None or df.empty:
            _, df = (
                Query()
                .select("name", "description", "exchange", "type", "close", "change", "market_cap_basic")
                .set_markets("america")
                .where(
                    col("type").isin(["stock", "fund", "etf"]),
                    col("is_primary") == True,  # noqa: E712
                    col("name").like(f"%{needle}%"),
                )
                .limit(limit)
                .get_scanner_data()
            )
        if df is None or df.empty:
            return []
        items = []
        for _, r in df.iterrows():
            items.append(
                {
                    "ticker": r.get("ticker"),
                    "symbol": r.get("name"),
                    "name": r.get("description"),
                    "exchange": r.get("exchange"),
                    "type": r.get("type"),
                    "price": _clean(r.get("close")),
                    "change_pct": _clean(r.get("change")),
                }
            )
        return items

    try:
        return {"items": _cached(f"search:{q.lower()}:{limit}", 30, fetch)}
    except Exception as e:
        raise HTTPException(502, f"Search failed: {e}") from e


@app.get("/api/history/{symbol}")
def history(symbol: str, range: str = "6mo"):
    if range not in RANGE_TO_YF:
        raise HTTPException(400, f"range must be one of {list(RANGE_TO_YF)}")
    period, interval = RANGE_TO_YF[range]
    yf_sym = symbol.strip().upper().split(":")[-1]
    if yf_sym == "VIX":
        yf_sym = "^VIX"

    def fetch():
        df = yf.download(
            yf_sym,
            period=period,
            interval=interval,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if df is None or df.empty:
            raise HTTPException(404, f"No history for {symbol}")
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.reset_index()
        time_col = "Datetime" if "Datetime" in df.columns else "Date"
        bars = []
        for _, r in df.iterrows():
            ts = pd.Timestamp(r[time_col])
            bars.append(
                {
                    "time": int(ts.timestamp()),
                    "open": _clean(r.get("Open")),
                    "high": _clean(r.get("High")),
                    "low": _clean(r.get("Low")),
                    "close": _clean(r.get("Close")),
                    "volume": _clean(r.get("Volume")),
                }
            )
        bars = [b for b in bars if b["close"] is not None]
        return {"symbol": yf_sym, "interval": interval, "range": range, "source": "yfinance", "bars": bars}

    ttl = 15 if range == "1d" else 60
    try:
        return _cached(f"hist:{yf_sym}:{range}", ttl, fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"History failed: {e}") from e


@app.get("/api/profile/{symbol}")
def profile(symbol: str):
    yf_sym = symbol.strip().upper().split(":")[-1]

    def fetch():
        t = yf.Ticker(yf_sym)
        info = t.info or {}
        keys = [
            "longName",
            "shortName",
            "sector",
            "industry",
            "website",
            "fullTimeEmployees",
            "longBusinessSummary",
            "city",
            "state",
            "country",
            "marketCap",
            "enterpriseValue",
            "trailingPE",
            "forwardPE",
            "pegRatio",
            "priceToBook",
            "profitMargins",
            "operatingMargins",
            "returnOnEquity",
            "returnOnAssets",
            "revenueGrowth",
            "earningsGrowth",
            "grossMargins",
            "ebitdaMargins",
            "currentRatio",
            "debtToEquity",
            "freeCashflow",
            "totalCash",
            "totalDebt",
            "trailingEps",
            "forwardEps",
            "dividendYield",
            "payoutRatio",
            "beta",
            "fiftyTwoWeekHigh",
            "fiftyTwoWeekLow",
            "averageVolume",
            "sharesOutstanding",
            "floatShares",
            "heldPercentInsiders",
            "heldPercentInstitutions",
            "targetMeanPrice",
            "targetHighPrice",
            "targetLowPrice",
            "numberOfAnalystOpinions",
            "recommendationKey",
            "earningsTimestamp",
        ]
        out = {k: _clean(info.get(k)) for k in keys}
        out["symbol"] = yf_sym
        out["source"] = "yfinance"
        return out

    try:
        return _cached(f"profile:{yf_sym}", 300, fetch)
    except Exception as e:
        raise HTTPException(502, f"Profile failed: {e}") from e


@app.get("/api/news/{symbol}")
def news(symbol: str, limit: int = 12):
    yf_sym = symbol.strip().upper().split(":")[-1]
    limit = max(1, min(limit, 25))

    def fetch():
        t = yf.Ticker(yf_sym)
        items = []
        for n in (t.news or [])[:limit]:
            content = n.get("content") or n
            title = content.get("title") or n.get("title")
            pub = content.get("pubDate") or n.get("providerPublishTime")
            url = None
            click = content.get("clickThroughUrl") or {}
            if isinstance(click, dict):
                url = click.get("url")
            url = url or n.get("link")
            provider = (content.get("provider") or {}).get("displayName") if isinstance(content.get("provider"), dict) else n.get("publisher")
            items.append(
                {
                    "title": title,
                    "url": url,
                    "publisher": provider,
                    "published": pub,
                }
            )
        return {"symbol": yf_sym, "source": "yfinance", "items": items}

    try:
        return _cached(f"news:{yf_sym}", 120, fetch)
    except Exception as e:
        raise HTTPException(502, f"News failed: {e}") from e


@app.get("/api/ta/{symbol}")
def ta(symbol: str, interval: str = "1d"):
    tv = resolve_tv_ticker(symbol)
    exchange, name = tv.split(":", 1)
    interval_map = {
        "15m": Interval.INTERVAL_15_MINUTES,
        "1h": Interval.INTERVAL_1_HOUR,
        "4h": Interval.INTERVAL_4_HOURS,
        "1d": Interval.INTERVAL_1_DAY,
        "1w": Interval.INTERVAL_1_WEEK,
    }
    iv = interval_map.get(interval)
    if not iv:
        raise HTTPException(400, f"interval must be one of {list(interval_map)}")

    def fetch():
        handler = TA_Handler(
            symbol=name,
            screener="america",
            exchange=exchange,
            interval=iv,
        )
        a = handler.get_analysis()
        return {
            "symbol": name,
            "exchange": exchange,
            "interval": interval,
            "summary": a.summary,
            "oscillators": a.oscillators,
            "moving_averages": a.moving_averages,
            "indicators": {k: _clean(v) for k, v in (a.indicators or {}).items()},
            "source": "tradingview-ta",
        }

    try:
        return _cached(f"ta:{tv}:{interval}", 30, fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"TA failed: {e}") from e


def _congress_block(symbol: str) -> dict[str, Any]:
    needle = symbol.strip().upper()

    def load():
        url = f"https://congressinvests.com/trades/{needle}"
        with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": "UtopiaTerminal/0.1"}) as client:
            r = client.get(url, params={"limit": 50})
            r.raise_for_status()
            return r.json()

    try:
        payload = _cached(f"congress:{needle}", 1800, load)
    except Exception:
        return {
            "buy_count": 0,
            "sell_count": 0,
            "tilt": "neutral",
            "items": [],
            "source": "congressinvests.com",
        }
    trades = payload.get("trades") if isinstance(payload, dict) else payload
    if not isinstance(trades, list):
        trades = []
    items = []
    net_buys = 0
    net_sells = 0
    for row in trades:
        kind = str(row.get("trade_type") or row.get("type") or "")
        low = kind.lower()
        if "buy" in low or "purchase" in low:
            net_buys += 1
        elif "sell" in low or "sale" in low:
            net_sells += 1
        if len(items) < 12:
            items.append(
                {
                    "date": row.get("tx_date") or row.get("disclosed") or row.get("transaction_date"),
                    "chamber": row.get("chamber"),
                    "person": row.get("member") or row.get("senator") or row.get("representative"),
                    "type": kind,
                    "amount": row.get("amount"),
                    "asset": row.get("asset"),
                }
            )
    tilt = "buy" if net_buys > net_sells else "sell" if net_sells > net_buys else "neutral"
    return {
        "buy_count": net_buys,
        "sell_count": net_sells,
        "tilt": tilt,
        "items": items,
        "source": "congressinvests.com",
    }


def _news_items(t: yf.Ticker, limit: int = 8) -> list[dict[str, Any]]:
    items = []
    for n in (t.news or [])[:limit]:
        content = n.get("content") or n
        title = content.get("title") or n.get("title")
        pub = content.get("pubDate") or n.get("providerPublishTime")
        click = content.get("clickThroughUrl") or {}
        url = click.get("url") if isinstance(click, dict) else None
        url = url or n.get("link")
        provider = (
            (content.get("provider") or {}).get("displayName")
            if isinstance(content.get("provider"), dict)
            else n.get("publisher")
        )
        items.append({"title": title, "url": url, "publisher": provider, "published": pub})
    return items


def _insider_block(t: yf.Ticker) -> dict[str, Any]:
    rows = []
    net = 0.0
    try:
        df = t.insider_transactions
        if df is not None and not df.empty:
            for _, r in df.head(12).iterrows():
                text = str(r.get("Text") or r.get("Transaction") or "")
                shares = _clean(r.get("Shares"))
                value = _clean(r.get("Value")) or 0
                is_buy = "purchase" in text.lower() or "buy" in text.lower()
                is_sell = "sale" in text.lower() or "sell" in text.lower()
                signed = (value or 0) if is_buy else -(value or 0) if is_sell else 0
                net += signed or 0
                start = r.get("Start Date")
                rows.append(
                    {
                        "date": str(start)[:10] if start is not None else None,
                        "insider": _clean(r.get("Insider")) or _clean(r.get("Name")),
                        "title": _clean(r.get("Position")) or _clean(r.get("Title")),
                        "text": text,
                        "shares": shares,
                        "value": _clean(r.get("Value")),
                    }
                )
    except Exception:
        pass
    tilt = "buy" if net > 0 else "sell" if net < 0 else "neutral"
    return {"net_value": net, "tilt": tilt, "items": rows, "source": "yfinance"}


def _options_block(t: yf.Ticker) -> dict[str, Any]:
    try:
        expiries = list(t.options or [])
    except Exception:
        expiries = []
    if not expiries:
        return {"expiry": None, "call_volume": 0, "put_volume": 0, "put_call": None, "items": []}

    def pack(df: pd.DataFrame, side: str, expiry: str) -> tuple[int, list[dict[str, Any]]]:
        if df is None or df.empty:
            return 0, []
        vol = int(pd.to_numeric(df.get("volume"), errors="coerce").fillna(0).sum())
        out = []
        work = df.copy()
        work["volume"] = pd.to_numeric(work.get("volume"), errors="coerce").fillna(0)
        work["openInterest"] = pd.to_numeric(work.get("openInterest"), errors="coerce").fillna(0)
        work["ratio"] = work["volume"] / work["openInterest"].clip(lower=1)
        work = work[work["volume"] >= 50].sort_values("volume", ascending=False).head(8)
        for _, r in work.iterrows():
            out.append(
                {
                    "side": side,
                    "expiry": expiry,
                    "contract": _clean(r.get("contractSymbol")),
                    "strike": _clean(r.get("strike")),
                    "last": _clean(r.get("lastPrice")),
                    "volume": _clean(r.get("volume")),
                    "open_interest": _clean(r.get("openInterest")),
                    "iv": _clean(r.get("impliedVolatility")),
                    "vol_oi": _clean(r.get("ratio")),
                }
            )
        return vol, out

    call_vol = 0
    put_vol = 0
    items: list[dict[str, Any]] = []
    used_expiry = expiries[0]
    for expiry in expiries[:3]:
        try:
            chain = t.option_chain(expiry)
        except Exception:
            continue
        c_vol, calls = pack(chain.calls, "call", expiry)
        p_vol, puts = pack(chain.puts, "put", expiry)
        call_vol += c_vol
        put_vol += p_vol
        items.extend(calls + puts)
        if expiry == expiries[0]:
            used_expiry = expiry
    pc = (put_vol / call_vol) if call_vol else None
    items = sorted(items, key=lambda x: x.get("volume") or 0, reverse=True)[:10]
    return {
        "expiry": used_expiry,
        "call_volume": call_vol,
        "put_volume": put_vol,
        "put_call": pc,
        "items": items,
        "source": "yfinance",
    }


def _forecast_block(info: dict[str, Any], price: float | None) -> dict[str, Any]:
    mean = _clean(info.get("targetMeanPrice"))
    high = _clean(info.get("targetHighPrice"))
    low = _clean(info.get("targetLowPrice"))
    n = _clean(info.get("numberOfAnalystOpinions"))
    rec = _clean(info.get("recommendationKey"))
    upside = None
    if mean and price:
        upside = (mean - price) / price * 100
    return {
        "target_mean": mean,
        "target_high": high,
        "target_low": low,
        "analysts": n,
        "recommendation": rec,
        "upside_pct": upside,
        "source": "yfinance",
    }


def _suggest(ta_label: str | None, rsi: float | None, insiders: dict, options: dict, congress: dict, forecast: dict) -> dict[str, Any]:
    score = 50
    reasons: list[str] = []
    label = (ta_label or "").upper()
    if "STRONG BUY" in label:
        score += 18
        reasons.append("TradingView daily rating is Strong Buy")
    elif "BUY" in label:
        score += 10
        reasons.append("TradingView daily rating is Buy")
    elif "STRONG SELL" in label:
        score -= 18
        reasons.append("TradingView daily rating is Strong Sell")
    elif "SELL" in label:
        score -= 10
        reasons.append("TradingView daily rating is Sell")

    if rsi is not None:
        if rsi < 30:
            score += 6
            reasons.append(f"RSI {rsi:.0f} is oversold")
        elif rsi > 70:
            score -= 6
            reasons.append(f"RSI {rsi:.0f} is overbought")

    if insiders.get("tilt") == "buy":
        score += 8
        reasons.append("Recent Form 4 flow nets to insider buying")
    elif insiders.get("tilt") == "sell":
        score -= 8
        reasons.append("Recent Form 4 flow nets to insider selling")

    pc = options.get("put_call")
    if pc is not None:
        if pc < 0.7:
            score += 6
            reasons.append(f"Near-term put/call volume {pc:.2f} is call-heavy")
        elif pc > 1.3:
            score -= 6
            reasons.append(f"Near-term put/call volume {pc:.2f} is put-heavy")

    if congress.get("tilt") == "buy":
        score += 4
        reasons.append("More Senate/House disclosures are purchases than sales")
    elif congress.get("tilt") == "sell":
        score -= 4
        reasons.append("More Senate/House disclosures are sales than purchases")

    upside = forecast.get("upside_pct")
    if upside is not None:
        if upside >= 15:
            score += 10
            reasons.append(f"Analyst mean target implies {upside:.0f}% upside")
        elif upside <= -10:
            score -= 10
            reasons.append(f"Analyst mean target implies {upside:.0f}% downside")

    rec = str(forecast.get("recommendation") or "").lower()
    if rec in ("buy", "strong_buy"):
        score += 6
        reasons.append(f"Street consensus is {rec.replace('_', ' ')}")
    elif rec in ("sell", "strong_sell", "underperform"):
        score -= 6
        reasons.append(f"Street consensus is {rec.replace('_', ' ')}")

    score = max(0, min(100, int(round(score))))
    if score >= 72:
        action = "ACCUMULATE"
    elif score >= 58:
        action = "LEAN LONG"
    elif score >= 45:
        action = "HOLD"
    elif score >= 32:
        action = "REDUCE"
    else:
        action = "AVOID"
    if not reasons:
        reasons.append("Insufficient overlapping signals; defaulting to a mid score")
    return {
        "action": action,
        "score": score,
        "reasons": reasons[:6],
        "disclaimer": "Heuristic research readout, not financial advice. You can lose money.",
    }


@app.get("/api/deep/{symbol}")
def deep(symbol: str):
    yf_sym = symbol.strip().upper().split(":")[-1]
    if yf_sym in {"SPY", "QQQ", "DIA", "IWM", "VIX"}:
        # still run; ETFs have thinner insider/congress hits
        pass

    def fetch():
        t = yf.Ticker(yf_sym)
        info = {}
        try:
            info = t.info or {}
        except Exception:
            info = {}
        quote = {}
        try:
            quote = _best_quote(yf_sym)
        except Exception:
            quote = {}
        price = quote.get("price")
        insiders = _insider_block(t)
        options = _options_block(t)
        congress = _congress_block(yf_sym)
        news = _news_items(t, 8)
        forecast = _forecast_block(info, price if isinstance(price, (int, float)) else None)
        ta_label = quote.get("recommend_label")
        try:
            ta_data = ta(yf_sym, "1d")
            ta_label = (ta_data.get("summary") or {}).get("RECOMMENDATION") or ta_label
            rsi = _clean((ta_data.get("indicators") or {}).get("RSI"))
        except Exception:
            rsi = quote.get("rsi")
            ta_data = None
        suggestion = _suggest(ta_label, rsi if isinstance(rsi, (int, float)) else quote.get("rsi"), insiders, options, congress, forecast)
        return {
            "symbol": yf_sym,
            "price": price,
            "name": quote.get("name") or info.get("shortName") or yf_sym,
            "insiders": insiders,
            "options": options,
            "congress": congress,
            "news": news,
            "forecast": forecast,
            "ta": {"label": ta_label, "rsi": quote.get("rsi") or rsi},
            "suggestion": suggestion,
            "as_of": int(time.time()),
        }

    try:
        return _cached(f"deep:{yf_sym}", 90, fetch)
    except Exception as e:
        raise HTTPException(502, f"Deep analysis failed: {e}") from e


@app.get("/api/snapshot")
def snapshot():
    """One payload for the dashboard: indices + three mover boards."""

    def fetch():
        idx = indices()["items"]
        g = movers("gainers")["items"]
        l = movers("losers")["items"]
        a = movers("active")["items"]
        return {"indices": idx, "gainers": g, "losers": l, "active": a, "as_of": int(time.time())}

    try:
        return _cached("snapshot", 15, fetch)
    except Exception as e:
        raise HTTPException(502, f"Snapshot failed: {e}") from e
