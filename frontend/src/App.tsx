import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import Chart from "./Chart";
import DeepPanel from "./DeepPanel";
import type { DeepAnalysis } from "./deep";
import type { Bar, NewsItem, Profile, Quote, TA } from "./types";

const WATCH = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "UNH", "XOM"];
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
function badgeClass(label?: string | null) {
  if (!label) return "badge";
  if (label.includes("BUY")) return "badge buy";
  if (label.includes("SELL")) return "badge sell";
  return "badge neutral";
}

function QuoteRow({
  q,
  selected,
  onPick,
}: {
  q: Quote;
  selected?: boolean;
  onPick: (s: string) => void;
}) {
  return (
    <button className={`row ${selected ? "sel" : ""}`} onClick={() => onPick(q.symbol)}>
      <span className="sym">{q.symbol}</span>
      <span>
        <div className="px">{fmt(q.price)}</div>
        <div className="meta">{q.name}</div>
      </span>
      <span className={`px ${cls(q.change_pct)}`}>{pct(q.change_pct)}</span>
    </button>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState("AAPL");
  const [range, setRange] = useState<(typeof RANGES)[number]>("6mo");
  const [board, setBoard] = useState<"gainers" | "losers" | "active">("gainers");
  const [indices, setIndices] = useState<Quote[]>([]);
  const [watch, setWatch] = useState<Quote[]>([]);
  const [movers, setMovers] = useState<Quote[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
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

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .snapshot()
        .then((s) => {
          if (!live) return;
          setIndices(s.indices);
          setAsOf(s.as_of);
          const map = { gainers: s.gainers, losers: s.losers, active: s.active };
          setMovers(map[board]);
        })
        .catch((e) => live && setErr(String(e.message || e)));
      api
        .quotes(WATCH)
        .then((r) => live && setWatch(r.items))
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 12_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [board]);

  useEffect(() => {
    let live = true;
    setErr(null);
    const loadQuote = () => {
      api
        .quote(symbol)
        .then((x) => live && setQuote(x))
        .catch((e) => live && setErr(String(e.message || e)));
    };
    loadQuote();
    api.history(symbol, range).then((h) => live && setBars(h.bars)).catch(() => live && setBars([]));
    api.news(symbol).then((n) => live && setNews(n.items)).catch(() => live && setNews([]));
    api.profile(symbol).then((p) => live && setProfile(p)).catch(() => live && setProfile(null));
    api.ta(symbol).then((t) => live && setTa(t)).catch(() => live && setTa(null));
    setDeep(null);
    setDeepLoading(true);
    setDeepErr(null);
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
    const id = setInterval(loadQuote, 8_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [symbol, range]);

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

  const rec = quote?.recommend_label || ta?.summary.RECOMMENDATION;
  const pick = (s: string) => {
    setSymbol(s);
    requestAnimationFrame(() => {
      document.getElementById("deep-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const stats = useMemo(
    () => [
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>UTOPIA TERMINAL</strong>
          <span>US equities · TradingView + Yahoo</span>
        </div>
        <div className="search">
          <input
            value={q}
            placeholder="Search ticker or name"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                setSymbol(q.trim().toUpperCase());
                setQ("");
                setHits([]);
                requestAnimationFrame(() => {
                  document.getElementById("deep-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }
            }}
          />
          {hits.length > 0 && (
            <div className="search-hits">
              {hits.map((h) => (
                <button
                  key={h.symbol}
                  onClick={() => {
                    setSymbol(h.symbol);
                    setQ("");
                    setHits([]);
                    requestAnimationFrame(() => {
                      document.getElementById("deep-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                >
                  <span>
                    <b className="sym">{h.symbol}</b> <span className="muted">{h.name}</span>
                  </span>
                  <span className={cls(h.change_pct)}>{pct(h.change_pct)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {rec && <span className={badgeClass(rec)}>{rec}</span>}
      </header>

      <nav className="strip">
        {indices.map((i) => (
          <button
            key={i.ticker}
            className={symbol === i.symbol ? "active" : ""}
            onClick={() => pick(i.symbol === "VIX" ? "VIX" : i.symbol)}
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
          {watch.map((w) => (
            <QuoteRow key={w.ticker} q={w} selected={w.symbol === symbol} onPick={pick} />
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
          {movers.map((m) => (
            <QuoteRow key={m.ticker} q={m} selected={m.symbol === symbol} onPick={pick} />
          ))}
        </aside>

        <main className="center">
          {err && <div className="err">{err}</div>}
          <div className="header">
            <div>
              <h1>{quote?.symbol || symbol}</h1>
              <div className="name">
                {quote?.name} {quote?.exchange ? `· ${quote.exchange}` : ""}{" "}
                {quote?.sector ? `· ${quote.sector}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={`bigpx ${cls(quote?.change_pct)}`}>{fmt(quote?.price)}</div>
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
          <div className="chart-wrap">
            <Chart bars={bars} />
          </div>
          <DeepPanel data={deep} loading={deepLoading} error={deepErr} />
        </main>

        <aside className="col">
          <div className="section-h">Daily TA (TradingView)</div>
          {ta && (
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr", padding: "0 12px 10px" }}>
              <div className="stat">
                <div className="k">Summary</div>
                <div className="v">{ta.summary.RECOMMENDATION ?? "—"}</div>
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
      <footer className="foot">
        <span>
          Quotes: TradingView scanner (unsigned ≈ 15m delay). Charts/news: Yahoo Finance. Not
          financial advice.
        </span>
        <span>{asOf ? new Date(asOf * 1000).toLocaleTimeString() : ""}</span>
      </footer>
    </div>
  );
}
