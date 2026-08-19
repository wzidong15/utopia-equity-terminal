# Utopia US Equity Terminal

Local US-stock research terminal: quotes, charts, movers, watchlist, paper portfolios, and optional LLM / heuristic analysis.

Open [http://localhost:5173](http://localhost:5173) after starting the app. Click a ticker (or search) to load its quote and chart. Use **Portfolios** to create a paper fund (name + starting dollars), simulate trades, or attach a simple automatic strategy. Deep analysis loads when you select a stock. LLM suggestions run when you click Generate.

This is a research UI, not a broker. **Not financial advice.** Data can be delayed, incomplete, or wrong.

## Features

- GitHub-style light UI: watchlist, US movers (gainers / losers / active), index strip (SPY, QQQ, DIA, IWM, VIX)
- Watchlist persisted in the browser (`localStorage`); add with ★, remove with ×
- Search by ticker or name
- OHLCV chart; default range is **1D** (`1d` / `5d` / `1mo` / `3mo` / `6mo` / `1y` / `5y`)
- Daily TradingView technical rating, Yahoo news, and company profile
- **Paper portfolios**: create a fund (name + starting dollars), place simulated buy/sell orders, attach buy-and-hold / SMA crossover / momentum / RSI strategies, and track NAV, P/L, drawdown, and a trade log. Auto strategies try a step every hour while `./start.sh` is running. Not a broker.
- **Deep analysis**: insider Form 4 flow, option volume / put-call, Senate and House PTRs, analyst targets, headlines, and a heuristic stance (`ACCUMULATE` … `AVOID`)
- **LLM suggestion** (Generate suggestion): BUY / SELL / LONG CALL / LONG PUT with macro context (SPY, QQQ, DIA, IWM, VIX) via OpenAI or Anthropic

Clicking a stock shows the header quote immediately when the ticker is already on the strip, watchlist, or movers. Charts and quotes cache briefly so switching back is faster.

## Quick start

Needs [Python 3.12+](https://www.python.org/), [uv](https://docs.astral.sh/uv/), Node.js, and npm.

```bash
chmod +x start.sh
./start.sh
```

| | URL |
|---|---|
| UI | http://localhost:5173 |
| API docs | http://localhost:8000/docs |

`start.sh` loads `.env` if present, creates `backend/.venv`, installs Python and npm deps, starts FastAPI on port 8000 (`--host ::`), then Vite on 5173 (Vite proxies `/api` to the backend).

On macOS, `start.sh` sets `UTOPIA_BIND_INTERFACE=en0` so outbound HTTPS can bind to Wi-Fi when automatic source-address selection fails (`Errno 49` / “Can't assign requested address”). Override with `UTOPIA_BIND_INTERFACE=` or `UTOPIA_BIND_IP=`.

## Optional keys

The app runs with no keys. Unsigned TradingView scanner quotes are typically **~15 minutes delayed**.

Copy the template and fill in what you use:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `UTOPIA_LIVE_REFRESH_SEC` | Selected ticker **price** poll interval in seconds (default `10`). News and Daily TA stay on-demand. |
| `UTOPIA_CHART_REFRESH_SEC` | Stock charts, NAV chart, and portfolio performance poll in seconds (default `30`). |
| `UTOPIA_STRATEGY_INTERVAL_SEC` | How often auto paper strategies try a step while the server is up (default `3600` = 1 hour). |
| `POLYGON_API_KEY` or `MASSIVE_API_KEY` | Last-trade snapshots (realtime when the plan allows) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | LLM suggestion (default model `gpt-4.1`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | LLM suggestion (default `claude-opus-4-20250514`) |
| `LLM_PROVIDER` | `auto` (OpenAI first if both keys are set), `openai`, or `anthropic` |

Free Polygon signup: https://polygon.io/dashboard/signup

A free Polygon plan may still reject some snapshot endpoints (`NOT_AUTHORIZED`). Quotes then fall back automatically.

## Data sources

| Panel | Source |
|---|---|
| Quotes / indices / watchlist | Polygon snapshot (if keyed) → TradingView scanner → yfinance download → Yahoo ticker → Stooq |
| Charts | Yahoo Finance `yf.download` |
| Movers | TradingView scanner, then Polygon gainers/losers if keyed |
| Daily TA | tradingview-ta |
| Profile, news, insiders, options, analyst targets | Yahoo Finance (`yfinance`) |
| Senate / House trades | [congressinvests.com](https://congressinvests.com) public ticker feed |
| LLM suggestion | OpenAI or Anthropic (only when a key is set and you click Generate) |

Do not treat unsigned TradingView or Yahoo prints as exchange-realtime.

## API

| Route | Role |
|---|---|
| `GET /api/health` | Liveness, Polygon flag, LLM provider flags |
| `GET /api/network-test` | Outbound HTTPS diagnostic |
| `GET /api/indices` | SPY, QQQ, DIA, IWM, VIX |
| `GET /api/snapshot` | Indices + mover boards |
| `GET /api/quote/{symbol}` | One quote |
| `GET /api/quotes?symbols=AAPL,MSFT` | Watchlist |
| `GET /api/movers?kind=gainers\|losers\|active` | US stocks |
| `GET /api/history/{symbol}?range=1d\|5d\|1mo\|3mo\|6mo\|1y\|5y` | OHLCV |
| `GET /api/profile/{symbol}` | Company profile |
| `GET /api/news/{symbol}` | Headlines |
| `GET /api/ta/{symbol}` | Daily TA summary |
| `GET /api/search?q=` | Symbol search |
| `GET /api/deep/{symbol}` | Insiders, options, Congress, news, forecast, heuristic suggestion |
| `POST /api/llm-advice/{symbol}` | LLM BUY/SELL/LONG CALL/LONG PUT |
| `GET /api/portfolios` | Paper portfolio summaries (marked to market) |
| `POST /api/portfolios` | Create fund `{name, amount}` |
| `GET /api/portfolios/{id}` | Holdings, trades, NAV snapshots |
| `DELETE /api/portfolios/{id}` | Delete fund |
| `POST /api/portfolios/{id}/orders` | Paper buy/sell (`shares` or `notional`) |
| `PUT /api/portfolios/{id}/strategy` | `manual` / `buy_hold` / `sma_cross` / `momentum` / `rsi_reversion` |
| `POST /api/portfolios/{id}/tick` | Mark to market; run auto strategy if enabled |

## Repo layout

```
backend/app.py          FastAPI app
backend/portfolios.py  Paper portfolios and strategies
backend/llm_advice.py   OpenAI / Anthropic calls
backend/requirements.txt
frontend/               Vite + React + Lightweight Charts
start.sh                Dev launcher (loads .env if present)
.env.example            Key placeholders — copy to .env locally
```

## Secrets

Never commit `.env` or API keys. `.env` is gitignored. `.env.example` only shows empty variable names and example model ids.

Deep analysis and LLM output are research aids over public feeds. You can lose money.

## License

[MIT](LICENSE) © 2026 Zidong
