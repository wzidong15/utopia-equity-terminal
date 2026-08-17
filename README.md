# Utopia US Equity Terminal

Local US-stock research terminal: live-ish quotes, charts, movers, and a per-ticker deep-analysis panel (insiders, options, Congress filings, news, forecast, and a research stance).

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) after starting the app. Click any ticker to load its chart and the deep-analysis block underneath.

This is a research UI, not a broker. **Not financial advice.** Data can be delayed, incomplete, or wrong.

## Features

- Watchlist, US movers (gainers / losers / active), and index strip
- Search by ticker or name
- OHLCV chart with range controls
- Daily TradingView technical rating
- **Deep analysis** (after you click a stock):
  - Insider Form 4 flow
  - Option volume / put-call on the next few expiries
  - Senate and House periodic transaction reports
  - Analyst targets and implied upside
  - Top headlines
  - Heuristic investment suggestion (`ACCUMULATE` … `AVOID`) with a 0–100 score

## Quick start

Needs [Python 3.12+](https://www.python.org/), [uv](https://docs.astral.sh/uv/), Node.js, and npm.

```bash
chmod +x start.sh
./start.sh
```

| | URL |
|---|---|
| UI | http://127.0.0.1:5173 |
| API docs | http://127.0.0.1:8000/docs |

`start.sh` creates `backend/.venv`, installs Python and npm deps, starts FastAPI on port 8000, then Vite on 5173 (Vite proxies `/api` to the backend).

### Optional realtime quotes

The app runs with no keys. Unsigned TradingView scanner quotes are typically **~15 minutes delayed**. Charts and news come from Yahoo Finance.

For last-trade snapshots from Polygon.io / Massive.com:

```bash
cp .env.example .env
```

Put your key in `.env` (gitignored):

```
POLYGON_API_KEY=your_key_here
```

Free signup: https://polygon.io/dashboard/signup

Quote source order: Polygon snapshot (if a key is set) → TradingView scanner → Yahoo.

A free Polygon plan may still reject some snapshot endpoints (`NOT_AUTHORIZED`). In that case quotes fall back automatically.

## Data sources

| Panel | Source |
|---|---|
| Quotes / indices | Polygon (optional) or TradingView scanner |
| Movers | TradingView scanner |
| Daily TA | tradingview-ta |
| Charts, profile, news, insiders, options, analyst targets | Yahoo Finance (`yfinance`) |
| Senate / House trades | [congressinvests.com](https://congressinvests.com) public ticker feed |

Do not treat unsigned TradingView or Yahoo prints as exchange-realtime.

## API

| Route | Role |
|---|---|
| `GET /api/health` | Liveness and which quote source is active |
| `GET /api/snapshot` | Indices + mover boards |
| `GET /api/quote/{symbol}` | One quote |
| `GET /api/quotes?symbols=AAPL,MSFT` | Watchlist |
| `GET /api/movers?kind=gainers\|losers\|active` | US stocks |
| `GET /api/history/{symbol}?range=1d\|5d\|1mo\|3mo\|6mo\|1y\|5y` | OHLCV |
| `GET /api/profile/{symbol}` | Company profile |
| `GET /api/news/{symbol}` | Headlines |
| `GET /api/ta/{symbol}` | Daily TA summary |
| `GET /api/search?q=` | Symbol search |
| `GET /api/deep/{symbol}` | Insiders, options, Congress, news, forecast, suggestion |

## Repo layout

```
backend/app.py          FastAPI app
backend/requirements.txt
frontend/               Vite + React + Lightweight Charts
start.sh                Dev launcher (loads .env if present)
.env.example            Polygon key placeholder — copy to .env locally
```

## Secrets

Never commit `.env` or API keys. `.env` is gitignored. `.env.example` only shows empty variable names.

The deep-analysis suggestion is a local heuristic over public feeds. You can lose money.

## License

[MIT](LICENSE) © 2026 Zidong
