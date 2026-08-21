import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { cls, fmt, fmtInt, pct, rvol } from "./format";
import type { Quote } from "./types";

const SECTORS = [
  "Electronic Technology",
  "Technology Services",
  "Finance",
  "Health Technology",
  "Retail Trade",
  "Energy Minerals",
  "Producer Manufacturing",
  "Consumer Durables",
  "Consumer Non-Durables",
  "Consumer Services",
  "Utilities",
  "Transportation",
  "Communications",
];

type Filters = {
  sector: string;
  cap_min: string;
  pe_max: string;
  rsi: string;
  change: string;
};

const DEFAULTS: Filters = {
  sector: "",
  cap_min: "2000000000",
  pe_max: "",
  rsi: "",
  change: "",
};

export default function ScreenerPanel({
  selected,
  onPick,
  watched,
  onToggleWatch,
}: {
  selected?: string;
  onPick: (s: string, preview?: Quote) => void;
  watched: (s: string) => boolean;
  onToggleWatch: (s: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [applied, setApplied] = useState<Filters>(DEFAULTS);
  const [items, setItems] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (applied.sector) q.set("sector", applied.sector);
    if (applied.cap_min) q.set("cap_min", applied.cap_min);
    if (applied.pe_max) q.set("pe_max", applied.pe_max);
    if (applied.rsi === "oversold") {
      q.set("rsi_max", "30");
    } else if (applied.rsi === "overbought") {
      q.set("rsi_min", "70");
    } else if (applied.rsi === "mid") {
      q.set("rsi_min", "30");
      q.set("rsi_max", "70");
    }
    if (applied.change === "up2") q.set("change_min", "2");
    if (applied.change === "up5") q.set("change_min", "5");
    if (applied.change === "down2") q.set("change_max", "-2");
    q.set("order", "change");
    q.set("limit", "20");
    return q.toString();
  }, [applied]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    api
      .screener(query)
      .then((r) => {
        if (!live) return;
        setItems(r.items || []);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setItems([]);
        setErr(String(e.message || e));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [query]);

  const set = (k: keyof Filters, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  return (
    <div className="screener">
      <form
        className="screen-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <select value={filters.sector} onChange={(e) => set("sector", e.target.value)} aria-label="Sector">
          <option value="">All sectors</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={filters.cap_min} onChange={(e) => set("cap_min", e.target.value)} aria-label="Market cap">
          <option value="">Any cap</option>
          <option value="2000000000">Cap &gt; $2B</option>
          <option value="10000000000">Cap &gt; $10B</option>
          <option value="50000000000">Cap &gt; $50B</option>
        </select>
        <select value={filters.pe_max} onChange={(e) => set("pe_max", e.target.value)} aria-label="P/E">
          <option value="">Any P/E</option>
          <option value="15">P/E &lt; 15</option>
          <option value="25">P/E &lt; 25</option>
          <option value="40">P/E &lt; 40</option>
        </select>
        <select value={filters.rsi} onChange={(e) => set("rsi", e.target.value)} aria-label="RSI">
          <option value="">Any RSI</option>
          <option value="oversold">RSI &lt; 30</option>
          <option value="mid">RSI 30–70</option>
          <option value="overbought">RSI &gt; 70</option>
        </select>
        <select value={filters.change} onChange={(e) => set("change", e.target.value)} aria-label="Change">
          <option value="">Any % chg</option>
          <option value="up2">&gt; +2%</option>
          <option value="up5">&gt; +5%</option>
          <option value="down2">&lt; −2%</option>
        </select>
        <button type="submit">Run</button>
      </form>
      {loading && items.length === 0 && <div className="watch-empty">Scanning…</div>}
      {err && items.length === 0 && !loading && <div className="watch-empty movers-err">{err}</div>}
      {!loading && !err && items.length === 0 && <div className="watch-empty">No names matched.</div>}
      {items.map((m) => {
        const rv = rvol(m);
        return (
          <div key={m.ticker} className={`row ${m.symbol === selected ? "sel" : ""}`}>
            <button type="button" className="row-main dense" onClick={() => onPick(m.symbol, m)}>
              <span className="sym">{m.symbol}</span>
              <span>
                <div className="px">{fmt(m.price)}</div>
                <div className="row-metrics">
                  <span>P/E {fmt(m.pe, 1)}</span>
                  <span className={rv == null ? "" : cls(rv - 1)}>{rv == null ? "RVOL —" : `${rv.toFixed(2)}×`}</span>
                  <span>{fmtInt(m.market_cap)}</span>
                </div>
              </span>
              <span className={`px ${cls(m.change_pct)}`}>{pct(m.change_pct)}</span>
            </button>
            <button
              type="button"
              className={`watch-btn ${watched(m.symbol) ? "on" : ""}`}
              title={watched(m.symbol) ? "Remove from watchlist" : "Add to watchlist"}
              aria-label={watched(m.symbol) ? `Remove ${m.symbol}` : `Add ${m.symbol}`}
              onClick={() => onToggleWatch(m.symbol)}
            >
              <svg
                className={`watch-icon ${watched(m.symbol) ? "on" : ""}`}
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden
              >
                <path
                  d="M8 1.8l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.77 3.2 13.5l.73-4.23-3.08-3 4.25-.62L8 1.8z"
                  fill={watched(m.symbol) ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
