---
name: utopia-equity-terminal
description: Builds and extends the Utopia US equity terminal (FastAPI + Vite React). Use when changing backend/app.py, the frontend, market-data sources, Polygon/Massive realtime quotes, TradingView screener, yfinance charts, or when the user asks to add panels to the stock website.
---

# Utopia equity terminal

Local US-stock visualization app in this repo. Not OpenBB Workspace.

## Stack

- Backend: `backend/app.py` (FastAPI, port 8000)
- Frontend: `frontend/` (Vite React, port 5173, proxies `/api`)
- Run: `./start.sh` (loads repo-root `.env` if present)

## Data source priority

Quotes (`/api/quote`, `/api/quotes`, `/api/indices`):

1. **Polygon / Massive** last-trade snapshot — only if `POLYGON_API_KEY` or `MASSIVE_API_KEY` is set (realtime)
2. TradingView scanner via `tradingview-screener` (~15m delay unsigned)
3. Yahoo `yfinance` fallback

Charts, profile, news: Yahoo Finance. Daily TA rating: `tradingview-ta`. Movers: TradingView scanner.

Do not claim unsigned TV/Yahoo quotes are exchange-realtime. UI footer must stay honest about delay.

## API (do not rename casually)

| Route | Role |
|---|---|
| `GET /api/health` | `polygon: bool` plus source labels |
| `GET /api/quote/{symbol}` | One quote |
| `GET /api/quotes?symbols=AAPL,MSFT` | Watchlist |
| `GET /api/indices` | SPY QQQ DIA IWM VIX |
| `GET /api/movers?kind=gainers\|losers\|active` | US stocks |
| `GET /api/history/{symbol}?range=1d\|5d\|1mo\|3mo\|6mo\|1y\|5y` | OHLCV |
| `GET /api/profile/{symbol}` | Yahoo fundamentals |
| `GET /api/news/{symbol}` | Yahoo news |
| `GET /api/ta/{symbol}` | TradingView summary |
| `GET /api/search?q=` | Symbol search |
| `GET /api/deep/{symbol}` | Insider (Yahoo Form 4), options (next 3 expiries), Congress (congressinvests.com), news, forecast, research stance |
| `GET /api/snapshot` | Dashboard bundle |

## UI conventions

Dark terminal: IBM Plex Sans/Mono, `--up` green / `--down` red / `--accent` amber. No gradients, no emoji. Keep the three-column layout (watchlist + movers | chart | TA/news).

## MCP / keys

- Polygon MCP is `polygon` in `~/.cursor/mcp.json` (binary `mcp_massive`; `POLYGON_API_KEY` still works).
- Never commit API keys. Put them in `~/.cursor/mcp.json` env and repo `.env` (gitignored).
- Do not add new MCPs (OpenBB, Unusual Whales, WeChat, etc.) unless the user approves.
- OpenInsider / Robinhood / Vibe-Trading are agent tools, not the website runtime unless explicitly wired.

## When extending

Prefer extending existing `/api/*` routes and `frontend/src/App.tsx`. Compute TA from OHLCV in-process when possible. If Polygon key is missing, keep TV+Yahoo working.
