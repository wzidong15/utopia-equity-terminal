import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import Chart from "./Chart";
import PortfolioPanel from "./PortfolioPanel";
import DeepPanel from "./DeepPanel";
import LlmAdvicePanel from "./LlmAdvicePanel";
import type { DeepAnalysis } from "./deep";
import type { Bar, NewsItem, Profile, Quote, TA } from "./types";
import { loadWatchlist, removeFromWatchlist, saveWatchlist, toggleWatchlistSymbol } from "./watchlist";
import { getCachedQuote, partialFromSearch, rememberQuote, rememberQuotes } from "./quoteCache";
import { fetchBars, getCachedBars, prefetchBars } from "./chartCache";
import { CHART_REFRESH_MS, LIVE_REFRESH_MS } from "./config";
import { marketClock } from "./marketSession";
const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"] as const;

function fmt(n?: number | null, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtInt(n?: number | null) {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}
function pct(n?: number | null) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function cls(n?: number | null) {
  if (n == null) return "";
  return n >= 0 ? "up" : "down";
}
function taBadgeClass(label?: string | null) {
  if (!label) return "badge ta-neutral";
  const u = label.toUpperCase();
  if (u.includes("STRONG BUY") || u.includes("STRONG_BUY")) return "badge ta-strong-buy";
  if (u.includes("BUY")) return "badge ta-buy";
  if (u.includes("STRONG SELL") || u.includes("STRONG_SELL")) return "badge ta-strong-sell";
  if (u.includes("SELL")) return "badge ta-sell";
  return "badge ta-neutral";
}

function SessionClock() {
  const [clock, setClock] = useState(() => marketClock());
  useEffect(() => {
    const id = window.setInterval(() => setClock(marketClock()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      className={`market-bar session-${clock.session}`}
      role="status"
      aria-live="polite"
      title={`US cash session · ${clock.hours}`}
    >
      <span className="market-dot" aria-hidden />
      <span className="market-label">{clock.label}</span>
      <span className="market-time">{clock.timeEt}</span>
      <span className="market-meta">
        <span className="market-day">{clock.weekday}</span>
        <span className="market-hours">{clock.hours}</span>
        <span className="market-until">{clock.until}</span>
      </span>
    </div>
  );
}

function WatchIcon({ active, title }: { active: boolean; title: string }) {
  return (
    <svg
      className={`watch-icon ${active ? "on" : ""}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
    >
      <title>{title}</title>
      <path
        d="M8 1.8l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.77 3.2 13.5l.73-4.23-3.08-3 4.25-.62L8 1.8z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg className="remove-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function QuoteRow({
  q,
  selected,
  onPick,
  watched,
  onToggleWatch,
  onRemoveWatch,
}: {
  q: Quote;
  selected?: boolean;
  onPick: (s: string, preview?: Quote) => void;
  watched?: boolean;
  onToggleWatch?: (s: string) => void;
  onRemoveWatch?: (s: string) => void;
}) {
  return (
    <div className={`row ${selected ? "sel" : ""}`}>
      <button type="button" className="row-main" onClick={() => onPick(q.symbol, q)}>
        <span className="sym">{q.symbol}</span>
        <span>
          <div className="px">{fmt(q.price)}</div>
          <div className="meta">{q.name}</div>
        </span>
        <span className={`px ${cls(q.change_pct)}`}>{pct(q.change_pct)}</span>
      </button>
      {onRemoveWatch ? (
        <button
          type="button"
          className="remove-btn"
          title="Remove from watchlist"
          aria-label={`Remove ${q.symbol} from watchlist`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveWatch(q.symbol);
          }}
        >
          <RemoveIcon />
        </button>
      ) : (
        onToggleWatch && (
          <button
            type="button"
            className={`watch-btn ${watched ? "on" : ""}`}
            title={watched ? "Remove from watchlist" : "Add to watchlist"}
            aria-label={watched ? `Remove ${q.symbol} from watchlist` : `Add ${q.symbol} to watchlist`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch(q.symbol);
            }}
          >
            <WatchIcon
              active={!!watched}
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
            />
          </button>
        )
      )}
    </div>
  );
}

function applyLiveLast(bars: Bar[], quote: Quote | null, symbol: string): Bar[] {
  if (!quote || quote.price == null || !Number.isFinite(quote.price) || bars.length === 0) return bars;
  const qsym = (quote.symbol || quote.ticker || "").toUpperCase().split(":").pop();
  if (qsym && qsym !== symbol.trim().toUpperCase()) return bars;
  const px = quote.price;
  const last = bars[bars.length - 1];
  const sess =
    quote.session === "pre" || quote.session === "post" || quote.session === "rth"
      ? quote.session
      : last.session;
  const high = last.high != null ? Math.max(last.high, px) : px;
  const low = last.low != null ? Math.min(last.low, px) : px;
  return [...bars.slice(0, -1), { ...last, close: px, high, low, session: sess || last.session }];
}

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [range, setRange] = useState<(typeof RANGES)[number]>("1d");
  const [board, setBoard] = useState<"gainers" | "losers" | "active">("gainers");
  const [indices, setIndices] = useState<Quote[]>([]);
  const [watchSymbols, setWatchSymbols] = useState<string[]>(() => loadWatchlist());
  const [watch, setWatch] = useState<Quote[]>([]);
  const [movers, setMovers] = useState<Quote[]>([]);
  const [moversLoading, setMoversLoading] = useState(false);
  const [moversErr, setMoversErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ta, setTa] = useState<TA | null>(null);
  const [deep, setDeep] = useState<DeepAnalysis | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<
    { symbol: string; name: string; exchange?: string; change_pct?: number }[]
  >([]);
  const [err, setErr] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [view, setView] = useState<"research" | "portfolios">("research");

  useEffect(() => {
    let live = true;
    const loadIndices = () => {
      api
        .indices()
        .then((r) => {
          if (!live) return;
          const items = r.items || [];
          rememberQuotes(items);
          setIndices(items);
          setAsOf(Math.floor(Date.now() / 1000));
        })
        .catch(() => undefined);
    };
    loadIndices();
    const id = setInterval(loadIndices, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let live = true;
    setMoversLoading(true);
    setMoversErr(null);
    const loadMovers = () => {
      api
        .movers(board)
        .then((r) => {
          if (!live) return;
          const items = r.items || [];
          rememberQuotes(items);
          setMovers(items);
          setMoversErr(r.error || (items.length ? null : "No movers returned"));
          setMoversLoading(false);
        })
        .catch((e) => {
          if (!live) return;
          setMovers([]);
          setMoversErr(String(e.message || e));
          setMoversLoading(false);
        });
    };
    loadMovers();
    const id = setInterval(loadMovers, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [board]);

  useEffect(() => {
    let live = true;
    const loadWatch = () => {
      if (watchSymbols.length === 0) {
        if (live) setWatch([]);
        return;
      }
      api
        .quotes(watchSymbols)
        .then((r) => {
          if (!live) return;
          const items = r.items || [];
          rememberQuotes(items);
          setWatch(items);
        })
        .catch(() => live && setWatch([]));
    };
    loadWatch();
    const id = setInterval(loadWatch, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [watchSymbols]);

  useEffect(() => {
    let live = true;
    setErr(null);
    setNews([]);
    setProfile(null);
    setTa(null);

    const cached = getCachedQuote(symbol);
    if (cached) setQuote(cached);
    else if (quote?.symbol?.toUpperCase() !== symbol) setQuote(null);

    setQuoteRefreshing(true);
    api
      .quote(symbol)
      .then((q) => {
        if (!live) return;
        rememberQuote(q);
        setQuote(q);
        setQuoteRefreshing(false);
      })
      .catch((e) => {
        if (!live) return;
        if (!cached) setErr(String(e.message || e));
        setQuoteRefreshing(false);
      });

    const quotePoll = setInterval(() => {
      api
        .quote(symbol)
        .then((x) => {
          if (!live) return;
          rememberQuote(x);
          setQuote(x);
        })
        .catch((e) => live && !getCachedQuote(symbol) && setErr(String(e.message || e)));
    }, LIVE_REFRESH_MS);

    const secondary = window.setTimeout(() => {
      api.news(symbol).then((n) => live && setNews(n.items)).catch(() => live && setNews([]));
      api.ta(symbol).then((t) => live && setTa(t)).catch(() => live && setTa(null));
    }, 300);

    const profileTimer = window.setTimeout(() => {
      api.profile(symbol).then((p) => live && setProfile(p)).catch(() => live && setProfile(null));
    }, 700);

    return () => {
      live = false;
      clearInterval(quotePoll);
      window.clearTimeout(secondary);
      window.clearTimeout(profileTimer);
    };
  }, [symbol]);

  useEffect(() => {
    let live = true;
    const cached = getCachedBars(symbol, range);
    if (cached) {
      setBars(cached);
      setBarsLoading(false);
    } else {
      setBarsLoading(true);
    }

    fetchBars(symbol, range)
      .then((bars) => {
        if (!live) return;
        setBars(bars);
        setBarsLoading(false);
      })
      .catch(() => {
        if (!live) return;
        if (!cached) setBars([]);
        setBarsLoading(false);
      });

    const chartPoll = setInterval(() => {
      fetchBars(symbol, range, { force: true })
        .then((next) => {
          if (!live) return;
          setBars(next);
        })
        .catch(() => undefined);
    }, CHART_REFRESH_MS);

    return () => {
      live = false;
      clearInterval(chartPoll);
    };
  }, [symbol, range]);

  useEffect(() => {
    let live = true;
    setDeep(null);
    setDeepErr(null);
    setDeepLoading(true);
    api
      .deep(symbol)
      .then((d) => {
        if (!live) return;
        setDeep(d);
        setDeepLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setDeepErr(String(e.message || e));
        setDeepLoading(false);
      });
    return () => {
      live = false;
    };
  }, [symbol]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(q).then((r) => setHits(r.items)).catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (s: string, preview?: Quote) => {
    const sym = s.trim().toUpperCase();
    const instant = preview ?? getCachedQuote(sym);
    if (instant) {
      rememberQuote(instant);
      setQuote(instant);
    }
    const cachedBars = getCachedBars(sym, range);
    if (cachedBars) setBars(cachedBars);
    prefetchBars(sym, range);
    setSymbol(sym);
  };
  const isWatched = (s: string) => watchSymbols.includes(s.trim().toUpperCase());
  const toggleWatch = (s: string) => {
    setWatchSymbols((prev) => {
      const next = toggleWatchlistSymbol(prev, s);
      saveWatchlist(next);
      return next;
    });
  };
  const removeWatch = (s: string) => {
    setWatchSymbols((prev) => {
      const next = removeFromWatchlist(prev, s);
      saveWatchlist(next);
      return next;
    });
  };
  const stats = useMemo(
    () => [
      ["Close", fmt(quote?.regular_close)],
      ["Prev close", fmt(quote?.prev_close)],
      ["Open", fmt(quote?.open)],
      ["High", fmt(quote?.high)],
      ["Low", fmt(quote?.low)],
      ["Volume", fmtInt(quote?.volume)],
      ["Mkt cap", fmtInt(quote?.market_cap)],
      ["P/E", fmt(quote?.pe)],
      ["RSI", fmt(quote?.rsi, 1)],
      ["SMA 20", fmt(quote?.sma20)],
      ["SMA 50", fmt(quote?.sma50)],
      ["SMA 200", fmt(quote?.sma200)],
      ["52w high", fmt(quote?.year_high)],
      ["52w low", fmt(quote?.year_low)],
    ],
    [quote],
  );
  const chartBars = useMemo(() => applyLiveLast(bars, quote, symbol), [bars, quote, symbol]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Fintopia</strong>
          <span>US equities · stock portfolio</span>
        </div>
        <div className="view-tabs">
          <button type="button" className={view === "research" ? "on" : ""} onClick={() => setView("research")}>
            Research
          </button>
          <button
            type="button"
            className={view === "portfolios" ? "on" : ""}
            onClick={() => setView("portfolios")}
          >
            Stock portfolio
          </button>
        </div>
        <div className="search">
          <svg className="search-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            placeholder="Search ticker or name"
            aria-label="Search ticker or name"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                const sym = q.trim().toUpperCase();
                const instant = getCachedQuote(sym) ?? partialFromSearch({ symbol: sym, name: sym });
                rememberQuote(instant);
                setQuote(instant);
                setSymbol(sym);
                setQ("");
                setHits([]);
                setView("research");
              }
            }}
          />
          {hits.length > 0 && (
            <div className="search-hits">
              {hits.map((h) => (
                <div key={h.symbol} className="search-hit">
                  <button
                    type="button"
                    onClick={() => {
                      pick(h.symbol, partialFromSearch(h));
                      setQ("");
                      setHits([]);
                      setView("research");
                    }}
                  >
                    <span>
                      <b className="sym">{h.symbol}</b> <span className="muted">{h.name}</span>
                    </span>
                    <span className={cls(h.change_pct)}>{pct(h.change_pct)}</span>
                  </button>
                  <button
                    type="button"
                    className={`watch-btn ${isWatched(h.symbol) ? "on" : ""}`}
                    title={isWatched(h.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                    aria-label={
                      isWatched(h.symbol)
                        ? `Remove ${h.symbol} from watchlist`
                        : `Add ${h.symbol} to watchlist`
                    }
                    onClick={() => toggleWatch(h.symbol)}
                  >
                    <WatchIcon
                      active={isWatched(h.symbol)}
                      title={isWatched(h.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>
      <SessionClock />

      {view === "research" && (
        <>
      <nav className="strip">
        {indices.map((i) => (
          <button
            key={i.ticker}
            className={symbol === i.symbol ? "active" : ""}
            onClick={() => pick(i.symbol === "VIX" ? "VIX" : i.symbol, i)}
          >
            <span className="sym">{i.symbol}</span>
            <span className="px">{fmt(i.price)}</span>
            <span className={cls(i.change_pct)}>{pct(i.change_pct)}</span>
          </button>
        ))}
      </nav>

      <div className="layout">
        <aside className="col">
          <div className="section-h">Watchlist</div>
          {watch.length === 0 && (
            <div className="watch-empty">Click ★ on a symbol to add it. Click × to remove.</div>
          )}
          {watch.map((w) => (
            <QuoteRow
              key={w.ticker}
              q={w}
              selected={w.symbol === symbol}
              onPick={pick}
              onRemoveWatch={removeWatch}
            />
          ))}
          <div className="section-h">
            US movers
            <div className="tabs">
              {(["gainers", "losers", "active"] as const).map((k) => (
                <button key={k} className={board === k ? "on" : ""} onClick={() => setBoard(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          {moversLoading && movers.length === 0 && (
            <div className="watch-empty">Loading {board}…</div>
          )}
          {moversErr && movers.length === 0 && !moversLoading && (
            <div className="watch-empty movers-err">Movers unavailable. Check network or API keys.</div>
          )}
          {movers.map((m) => (
            <QuoteRow
              key={m.ticker}
              q={m}
              selected={m.symbol === symbol}
              onPick={pick}
              watched={isWatched(m.symbol)}
              onToggleWatch={toggleWatch}
            />
          ))}
        </aside>

        <main className="center">
          {err && <div className="err">{err}</div>}
          <div className="header">
            <div>
              <div className="title-row">
                <h1>{quote?.symbol || symbol}</h1>
                <button
                  type="button"
                  className={`watch-btn header-watch ${isWatched(symbol) ? "on" : ""}`}
                  title={isWatched(symbol) ? "Remove from watchlist" : "Add to watchlist"}
                  aria-label={
                    isWatched(symbol)
                      ? `Remove ${symbol} from watchlist`
                      : `Add ${symbol} to watchlist`
                  }
                  onClick={() => toggleWatch(symbol)}
                >
                  <WatchIcon
                    active={isWatched(symbol)}
                    title={isWatched(symbol) ? "Remove from watchlist" : "Add to watchlist"}
                  />
                </button>
              </div>
              <div className="name">
                {quote?.name} {quote?.exchange ? `· ${quote.exchange}` : ""}{" "}
                {quote?.sector ? `· ${quote.sector}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={`bigpx ${cls(quote?.change_pct)}${quoteRefreshing ? " refreshing" : ""}`}>
                {fmt(quote?.price)}
              </div>
              {(quote?.session === "pre" || quote?.session === "post" || quote?.session === "closed") &&
                quote?.regular_close != null && (
                  <div className="muted">
                    {quote.session === "pre"
                      ? "Pre-market last"
                      : quote.session === "post"
                        ? "After hours last"
                        : "After hours last · ended 8:00 PM ET"}
                    {" · "}
                    Close {fmt(quote.regular_close)}
                    {quote.vs_close_pct != null ? ` · AH ${pct(quote.vs_close_pct)}` : ""}
                  </div>
                )}
              <div className={cls(quote?.change_pct)}>
                {fmt(quote?.change)} ({pct(quote?.change_pct)})
              </div>
            </div>
          </div>
          <div className="range">
            {RANGES.map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="stats">
            {stats.map(([k, v]) => (
              <div className="stat" key={k}>
                <div className="k">{k}</div>
                <div className="v">{v}</div>
              </div>
            ))}
          </div>
          <div className={`chart-wrap${barsLoading ? " chart-loading-active" : ""}`}>
            {barsLoading && bars.length === 0 && <div className="chart-loading">Loading chart…</div>}
            <Chart bars={chartBars} />
            {chartBars.some((b) => b.session === "pre" || b.session === "post") && (
              <div className="muted chart-note">
                Includes Yahoo pre-market (amber) and post-market (blue) candles.
              </div>
            )}
          </div>
          <LlmAdvicePanel symbol={symbol} />
          <DeepPanel data={deep} loading={deepLoading} error={deepErr} />
        </main>

        <aside className="col">
          <div className="section-h">Daily TA (TradingView)</div>
          {ta && (
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr", padding: "0 12px 10px" }}>
              <div className="stat">
                <div className="k">Summary</div>
                <div className={`v ${taBadgeClass(ta.summary.RECOMMENDATION)}`}>
                  {(ta.summary.RECOMMENDATION ?? "—").replace(/_/g, " ")}
                </div>
              </div>
              <div className="stat">
                <div className="k">Buy / Neutral / Sell</div>
                <div className="v">
                  {ta.summary.BUY ?? 0} / {ta.summary.NEUTRAL ?? 0} / {ta.summary.SELL ?? 0}
                </div>
              </div>
            </div>
          )}
          <div className="section-h">News (Yahoo)</div>
          <div className="news">
            {news.map((n, i) => (
              <a key={i} href={n.url || "#"} target="_blank" rel="noreferrer">
                {n.title}
                <div className="src">
                  {n.publisher}
                  {n.published ? ` · ${String(n.published).slice(0, 16)}` : ""}
                </div>
              </a>
            ))}
          </div>
          {profile?.longBusinessSummary && (
            <>
              <div className="section-h">Profile</div>
              <div className="summary">{String(profile.longBusinessSummary).slice(0, 700)}</div>
            </>
          )}
        </aside>
      </div>
        </>
      )}
      {view === "portfolios" && (
        <PortfolioPanel
          onOpenSymbol={(s) => {
            pick(s);
            setView("research");
          }}
        />
      )}
      <footer className="foot">
        <span>
          Quotes: TradingView scanner (unsigned ≈ 15m delay). Charts/news: Yahoo Finance. Stock
          portfolio is paper shares only — no options. Not financial advice.
        </span>
        <span>{asOf ? new Date(asOf * 1000).toLocaleTimeString() : ""}</span>
      </footer>
    </div>
  );
}
