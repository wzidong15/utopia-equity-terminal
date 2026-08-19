"""Stock portfolios: paper funds that buy/sell shares (no options), run simple strategies, track NAV."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "portfolios.json"
MAX_PORTFOLIOS = 20
MAX_TRADES = 250
MAX_SNAPSHOTS = 600
_stop = threading.Event()
_scheduler: threading.Thread | None = None

Kind = Literal["manual", "buy_hold", "sma_cross", "momentum", "rsi_reversion"]

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])
_lock = threading.Lock()

_quote: Callable[[str], dict[str, Any]] | None = None
_quotes: Callable[[list[str]], list[dict[str, Any]]] | None = None
_history: Callable[[str, str], dict[str, Any]] | None = None
_movers: Callable[[str, int], list[dict[str, Any]]] | None = None


def configure(
    *,
    quote: Callable[[str], dict[str, Any]],
    quotes: Callable[[list[str]], list[dict[str, Any]]],
    history: Callable[[str, str], dict[str, Any]],
    movers: Callable[[str, int], list[dict[str, Any]]],
) -> None:
    global _quote, _quotes, _history, _movers
    _quote = quote
    _quotes = quotes
    _history = history
    _movers = movers
    start_scheduler()


def _strategy_interval_sec() -> float:
    raw = (os.environ.get("UTOPIA_STRATEGY_INTERVAL_SEC") or "3600").strip()
    try:
        sec = float(raw)
    except ValueError:
        sec = 3600.0
    return max(60.0, min(sec, 24 * 3600.0))


def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.is_alive():
        return
    _stop.clear()
    _scheduler = threading.Thread(target=_scheduler_loop, name="utopia-auto-strategy", daemon=True)
    _scheduler.start()


def stop_scheduler() -> None:
    _stop.set()


def _scheduler_loop() -> None:
    # Let the API finish booting / outbound network settle, then honor the hourly cadence.
    if _stop.wait(15):
        return
    while not _stop.is_set():
        try:
            run_due_auto_strategies()
        except Exception:
            pass
        if _stop.wait(30):
            return


class CreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0, le=1e12)


class OrderBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    side: Literal["buy", "sell"]
    shares: float | None = Field(default=None, gt=0)
    notional: float | None = Field(default=None, gt=0)


class StrategyBody(BaseModel):
    kind: Kind
    auto: bool = False
    symbol: str = "SPY"


def _empty_store() -> dict[str, Any]:
    return {"portfolios": []}


def _load() -> dict[str, Any]:
    if not DATA_FILE.is_file():
        return _empty_store()
    try:
        return json.loads(DATA_FILE.read_text())
    except Exception:
        return _empty_store()


def _save(store: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, default=str))
    tmp.replace(DATA_FILE)


def _now() -> int:
    return int(time.time())


def _money(n: float) -> float:
    return round(float(n), 2)


def _shares(n: float) -> float:
    return round(float(n), 6)


def _find(store: dict[str, Any], pid: str) -> dict[str, Any]:
    for p in store.get("portfolios") or []:
        if p.get("id") == pid:
            return p
    raise HTTPException(404, "Portfolio not found")


def _price_map(symbols: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    uniq = [s.upper() for s in dict.fromkeys(symbols) if s]
    if not uniq or _quotes is None:
        return out
    try:
        rows = _quotes(uniq)
    except Exception:
        rows = []
    for row in rows:
        sym = str(row.get("symbol") or "").upper()
        px = row.get("price")
        if sym and isinstance(px, (int, float)) and px > 0:
            out[sym] = float(px)
    missing = [s for s in uniq if s not in out]
    if missing and _quote is not None:
        for s in missing:
            try:
                q = _quote(s)
                px = q.get("price")
                if isinstance(px, (int, float)) and px > 0:
                    out[s] = float(px)
            except Exception:
                continue
    return out


def _nav(p: dict[str, Any], prices: dict[str, float]) -> float:
    total = float(p.get("cash") or 0)
    for sym, h in (p.get("holdings") or {}).items():
        shares = float(h.get("shares") or 0)
        px = prices.get(sym) or float(h.get("last_price") or 0)
        total += shares * px
        if px:
            h["last_price"] = _money(px)
            h["market_value"] = _money(shares * px)
    return _money(total)


def _snapshot(p: dict[str, Any], nav: float, *, force: bool = False) -> None:
    snaps = p.setdefault("snapshots", [])
    now = _now()
    if not force and snaps:
        last = snaps[-1]
        if now - int(last.get("t") or 0) < 20:
            last["t"] = now
            last["nav"] = nav
            last["cash"] = _money(p.get("cash") or 0)
            return
    snaps.append({"t": now, "nav": nav, "cash": _money(p.get("cash") or 0)})
    if len(snaps) > MAX_SNAPSHOTS:
        p["snapshots"] = snaps[-MAX_SNAPSHOTS:]


def _record_trade(p: dict[str, Any], **trade: Any) -> None:
    trades = p.setdefault("trades", [])
    trades.append({"t": _now(), **trade})
    if len(trades) > MAX_TRADES:
        p["trades"] = trades[-MAX_TRADES:]


def _fill_order(p: dict[str, Any], symbol: str, side: str, shares: float, price: float, source: str) -> None:
    symbol = symbol.upper()
    holdings = p.setdefault("holdings", {})
    cash = float(p.get("cash") or 0)
    notional = shares * price
    if side == "buy":
        if notional > cash + 0.01:
            raise HTTPException(400, f"Insufficient cash (${cash:.2f}) for ${notional:.2f} buy")
        h = holdings.get(symbol) or {"shares": 0.0, "avg_cost": 0.0}
        prev_sh = float(h["shares"])
        prev_cost = float(h["avg_cost"])
        new_sh = prev_sh + shares
        h["avg_cost"] = _money((prev_sh * prev_cost + notional) / new_sh) if new_sh else 0.0
        h["shares"] = _shares(new_sh)
        h["last_price"] = _money(price)
        holdings[symbol] = h
        p["cash"] = _money(cash - notional)
    else:
        h = holdings.get(symbol)
        if not h or float(h.get("shares") or 0) + 1e-9 < shares:
            have = float((h or {}).get("shares") or 0)
            raise HTTPException(400, f"Insufficient shares of {symbol} ({have})")
        h["shares"] = _shares(float(h["shares"]) - shares)
        if h["shares"] <= 1e-8:
            holdings.pop(symbol, None)
        else:
            holdings[symbol] = h
        p["cash"] = _money(cash + notional)
    p["updated_at"] = _now()
    _record_trade(
        p,
        symbol=symbol,
        side=side,
        shares=_shares(shares),
        price=_money(price),
        notional=_money(notional),
        source=source,
    )


def _sma(closes: list[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def _run_strategy(p: dict[str, Any], prices: dict[str, float], *, force: bool = False) -> str:
    st = p.get("strategy") or {}
    kind = st.get("kind") or "manual"
    if kind == "manual":
        return "manual"
    now = _now()
    last = int(st.get("last_run_at") or 0)
    if not force and last and now - last < _strategy_interval_sec():
        return "cooldown"
    note = "no action"
    try:
        if kind == "buy_hold":
            note = _strat_buy_hold(p, prices, str(st.get("symbol") or "SPY").upper())
        elif kind == "sma_cross":
            note = _strat_sma_cross(p, prices, str(st.get("symbol") or "SPY").upper())
        elif kind == "momentum":
            note = _strat_momentum(p, prices)
        elif kind == "rsi_reversion":
            note = _strat_rsi(p, prices, str(st.get("symbol") or "SPY").upper())
    except HTTPException as e:
        note = str(e.detail)
        p["last_error"] = note
    except Exception as e:
        note = str(e)
        p["last_error"] = note
    else:
        p["last_error"] = None
    st["last_run_at"] = now
    st["note"] = note
    p["strategy"] = st
    return note


def _strat_buy_hold(p: dict[str, Any], prices: dict[str, float], symbol: str) -> str:
    cash = float(p.get("cash") or 0)
    held = (p.get("holdings") or {}).get(symbol)
    if held and float(held.get("shares") or 0) > 0:
        return f"holding {symbol}"
    px = prices.get(symbol)
    if not px and _quote is not None:
        q = _quote(symbol)
        px = float(q["price"]) if q.get("price") else None
        if px:
            prices[symbol] = px
    if not px:
        return f"no price for {symbol}"
    if cash < px:
        return "cash too small to buy 1 share"
    shares = _shares((cash * 0.99) / px)
    if shares <= 0:
        return "no shares"
    _fill_order(p, symbol, "buy", shares, px, "buy_hold")
    return f"bought {shares} {symbol}"


def _strat_sma_cross(p: dict[str, Any], prices: dict[str, float], symbol: str) -> str:
    if _history is None:
        return "history unavailable"
    hist = _history(symbol, "6mo")
    closes = [float(b["close"]) for b in (hist.get("bars") or []) if b.get("close") is not None]
    fast = _sma(closes, 20)
    slow = _sma(closes, 50)
    if fast is None or slow is None:
        return "not enough bars for SMA"
    px = prices.get(symbol)
    if not px:
        px = closes[-1]
        prices[symbol] = px
    held = float(((p.get("holdings") or {}).get(symbol) or {}).get("shares") or 0)
    if fast > slow and held <= 0:
        cash = float(p.get("cash") or 0)
        shares = _shares((cash * 0.99) / px) if px else 0
        if shares <= 0:
            return "SMA golden cross, no cash"
        _fill_order(p, symbol, "buy", shares, px, "sma_cross")
        return f"golden cross: bought {shares} {symbol}"
    if fast < slow and held > 0:
        _fill_order(p, symbol, "sell", held, px, "sma_cross")
        return f"death cross: sold {held} {symbol}"
    return f"SMA20={fast:.2f} SMA50={slow:.2f}, hold"


def _strat_momentum(p: dict[str, Any], prices: dict[str, float]) -> str:
    if _movers is None:
        return "movers unavailable"
    gainers = _movers("gainers", 8)
    picks: list[str] = []
    for g in gainers:
        sym = str(g.get("symbol") or "").upper()
        px = g.get("price")
        if not sym or not isinstance(px, (int, float)) or px < 5:
            continue
        prices[sym] = float(px)
        picks.append(sym)
        if len(picks) >= 3:
            break
    if not picks:
        return "no gainers"
    holdings = dict(p.get("holdings") or {})
    for sym, h in holdings.items():
        if sym not in picks and float(h.get("shares") or 0) > 0:
            px = prices.get(sym) or float(h.get("last_price") or 0)
            if px:
                _fill_order(p, sym, "sell", float(h["shares"]), px, "momentum")
    cash = float(p.get("cash") or 0)
    if cash < 10:
        return f"rotated into {', '.join(picks)}; little cash left"
    slice_amt = cash / len(picks)
    bought = []
    for sym in picks:
        px = prices.get(sym)
        if not px:
            continue
        shares = _shares((slice_amt * 0.99) / px)
        if shares <= 0:
            continue
        _fill_order(p, sym, "buy", shares, px, "momentum")
        bought.append(sym)
    return "momentum: " + (", ".join(bought) if bought else "no buys")


def _strat_rsi(p: dict[str, Any], prices: dict[str, float], symbol: str) -> str:
    if _quote is None:
        return "quote unavailable"
    q = _quote(symbol)
    px = q.get("price")
    rsi = q.get("rsi")
    if isinstance(px, (int, float)) and px > 0:
        prices[symbol] = float(px)
    else:
        return f"no price for {symbol}"
    if not isinstance(rsi, (int, float)):
        return "no RSI on quote"
    held = float(((p.get("holdings") or {}).get(symbol) or {}).get("shares") or 0)
    if rsi < 30 and held <= 0:
        cash = float(p.get("cash") or 0)
        shares = _shares((cash * 0.25) / float(px))
        if shares <= 0:
            return f"RSI {rsi:.1f} oversold, no cash"
        _fill_order(p, symbol, "buy", shares, float(px), "rsi_reversion")
        return f"RSI {rsi:.1f}: bought {shares} {symbol}"
    if rsi > 70 and held > 0:
        _fill_order(p, symbol, "sell", held, float(px), "rsi_reversion")
        return f"RSI {rsi:.1f}: sold {held} {symbol}"
    return f"RSI {rsi:.1f}, hold"


def _symbols(p: dict[str, Any]) -> list[str]:
    symbols = list((p.get("holdings") or {}).keys())
    st_sym = ((p.get("strategy") or {}).get("symbol") or "").upper()
    if st_sym:
        symbols.append(st_sym)
    return symbols


def _holding_prices(p: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for sym, h in (p.get("holdings") or {}).items():
        px = h.get("last_price")
        if isinstance(px, (int, float)) and px > 0:
            out[str(sym).upper()] = float(px)
    return out


def _enrich(p: dict[str, Any], prices: dict[str, float] | None = None) -> dict[str, Any]:
    if prices is None:
        prices = {**_holding_prices(p), **_price_map(_symbols(p))}
    nav = _nav(p, prices)
    initial = float(p.get("initial_cash") or 0) or 1.0
    pnl = _money(nav - initial)
    ret = (nav - initial) / initial * 100
    snaps = p.get("snapshots") or []
    peak = initial
    max_dd = 0.0
    for s in snaps:
        n = float(s.get("nav") or 0)
        peak = max(peak, n)
        if peak > 0:
            max_dd = min(max_dd, (n - peak) / peak)
    holdings_out = []
    for sym, h in (p.get("holdings") or {}).items():
        shares = float(h.get("shares") or 0)
        last = prices.get(sym) or float(h.get("last_price") or 0)
        avg = float(h.get("avg_cost") or 0)
        mv = shares * last
        holdings_out.append(
            {
                "symbol": sym,
                "shares": shares,
                "avg_cost": avg,
                "last_price": _money(last) if last else None,
                "market_value": _money(mv),
                "unrealized_pnl": _money(mv - shares * avg) if last else None,
            }
        )
    holdings_out.sort(key=lambda x: -(x.get("market_value") or 0))
    st = dict(p.get("strategy") or {})
    last = int(st.get("last_run_at") or 0)
    interval = int(_strategy_interval_sec())
    st["interval_sec"] = interval
    if st.get("auto") and st.get("kind") not in (None, "manual"):
        st["next_run_at"] = (last + interval) if last else _now()
    return {
        **{k: v for k, v in p.items() if k not in ("holdings", "strategy")},
        "strategy": st,
        "holdings": holdings_out,
        "nav": nav,
        "pnl": pnl,
        "return_pct": round(ret, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "prices": prices,
    }


def _summary(p: dict[str, Any], prices: dict[str, float] | None = None) -> dict[str, Any]:
    e = _enrich(p, prices)
    return {
        "id": e["id"],
        "name": e["name"],
        "initial_cash": e["initial_cash"],
        "cash": e["cash"],
        "nav": e["nav"],
        "pnl": e["pnl"],
        "return_pct": e["return_pct"],
        "strategy": e.get("strategy"),
        "updated_at": e.get("updated_at"),
        "created_at": e.get("created_at"),
        "holdings_count": len(e.get("holdings") or []),
        "last_error": e.get("last_error"),
    }


@router.get("")
def list_portfolios():
    with _lock:
        copies = [copy.deepcopy(p) for p in (_load().get("portfolios") or [])]
    items = [_summary(p, _holding_prices(p)) for p in copies]
    items.sort(key=lambda x: -(x.get("updated_at") or 0))
    return {"items": items}


@router.post("")
def create_portfolio(body: CreateBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    with _lock:
        store = _load()
        if len(store.get("portfolios") or []) >= MAX_PORTFOLIOS:
            raise HTTPException(400, f"At most {MAX_PORTFOLIOS} portfolios")
        now = _now()
        p = {
            "id": uuid.uuid4().hex[:12],
            "name": name,
            "initial_cash": _money(body.amount),
            "cash": _money(body.amount),
            "created_at": now,
            "updated_at": now,
            "holdings": {},
            "trades": [],
            "snapshots": [{"t": now, "nav": _money(body.amount), "cash": _money(body.amount)}],
            "strategy": {"kind": "manual", "auto": False, "symbol": "SPY", "last_run_at": 0, "note": ""},
            "last_error": None,
        }
        store.setdefault("portfolios", []).append(p)
        _save(store)
        return _enrich(p)


@router.get("/{pid}")
def get_portfolio(pid: str, live: bool = True):
    with _lock:
        p = copy.deepcopy(_find(_load(), pid))
    prices = _holding_prices(p)
    if live:
        prices = {**prices, **_price_map(_symbols(p))}
    out = _enrich(p, prices)
    if live:
        with _lock:
            store = _load()
            cur = _find(store, pid)
            _snapshot(cur, out["nav"])
            holdings = cur.get("holdings") or {}
            for sym, px in prices.items():
                h = holdings.get(sym)
                if h:
                    h["last_price"] = _money(px)
            _save(store)
    return out


@router.delete("/{pid}")
def delete_portfolio(pid: str):
    with _lock:
        store = _load()
        before = len(store.get("portfolios") or [])
        store["portfolios"] = [p for p in store.get("portfolios") or [] if p.get("id") != pid]
        if len(store["portfolios"]) == before:
            raise HTTPException(404, "Portfolio not found")
        _save(store)
    return {"ok": True}


@router.post("/{pid}/orders")
def place_order(pid: str, body: OrderBody):
    symbol = body.symbol.strip().upper().split(":")[-1]
    if body.shares is None and body.notional is None:
        raise HTTPException(400, "Provide shares or notional")
    if _quote is None:
        raise HTTPException(502, "Quote source not configured")
    try:
        q = _quote(symbol)
    except Exception as e:
        raise HTTPException(502, f"Quote failed: {e}") from e
    px = q.get("price")
    if not isinstance(px, (int, float)) or px <= 0:
        raise HTTPException(502, f"No price for {symbol}")
    shares = float(body.shares) if body.shares else float(body.notional) / float(px)
    shares = _shares(shares)
    if shares <= 0:
        raise HTTPException(400, "Order size too small")
    with _lock:
        store = _load()
        p = _find(store, pid)
        _fill_order(p, symbol, body.side, shares, float(px), "manual")
        out = _enrich(p)
        _snapshot(p, out["nav"], force=True)
        _save(store)
        return out


@router.put("/{pid}/strategy")
def set_strategy(pid: str, body: StrategyBody):
    with _lock:
        store = _load()
        p = _find(store, pid)
        p["strategy"] = {
            "kind": body.kind,
            "auto": bool(body.auto) and body.kind != "manual",
            "symbol": body.symbol.strip().upper().split(":")[-1] or "SPY",
            "last_run_at": (p.get("strategy") or {}).get("last_run_at") or 0,
            "note": (p.get("strategy") or {}).get("note") or "",
        }
        p["updated_at"] = _now()
        _save(store)
        return _enrich(p)


def run_due_auto_strategies() -> int:
    """Execute auto strategies that are due (default: every 1 hour). Returns how many ran."""
    ran = 0
    with _lock:
        store = _load()
        interval = _strategy_interval_sec()
        now = _now()
        for p in store.get("portfolios") or []:
            st = p.get("strategy") or {}
            if not st.get("auto") or st.get("kind") in (None, "manual"):
                continue
            last = int(st.get("last_run_at") or 0)
            if last and now - last < interval:
                continue
            symbols = list((p.get("holdings") or {}).keys())
            if st.get("symbol"):
                symbols.append(str(st["symbol"]).upper())
            prices = _price_map(symbols)
            _run_strategy(p, prices, force=True)
            _snapshot(p, _nav(p, prices), force=True)
            p["updated_at"] = now
            ran += 1
        if ran:
            _save(store)
    return ran


@router.post("/{pid}/tick")
def tick_portfolio(pid: str, force: bool = False):
    with _lock:
        store = _load()
        p = _find(store, pid)
        st = p.get("strategy") or {}
        symbols = list((p.get("holdings") or {}).keys())
        if st.get("symbol"):
            symbols.append(str(st["symbol"]).upper())
        prices = _price_map(symbols)
        note = None
        kind = st.get("kind")
        if kind not in (None, "manual") and (force or st.get("auto")):
            note = _run_strategy(p, prices, force=force)
        nav = _nav(p, prices)
        _snapshot(p, nav, force=True)
        p["updated_at"] = _now()
        _save(store)
        out = _enrich(p)
        out["tick_note"] = note
        return out
