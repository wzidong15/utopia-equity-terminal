import { useEffect, useState } from "react";
import { api, type SearchHit } from "./api";
import { getCachedQuote, partialFromSearch, rememberQuote } from "./quoteCache";
import type { Quote } from "./types";

function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function pct(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function cls(n?: number | null) {
  if (n == null) return "";
  return n >= 0 ? "up" : "down";
}
function compact(n?: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function SymbolSearch({
  value,
  onChange,
  onQuote,
  placeholder = "Search stock or ETF",
}: {
  value: string;
  onChange: (symbol: string) => void;
  onQuote?: (quote: Quote | null) => void;
  placeholder?: string;
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    if (!open || !value.trim()) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .search(value.trim())
        .then((r) => setHits(r.items || []))
        .catch(() => setHits([]));
    }, 220);
    return () => window.clearTimeout(t);
  }, [value, open]);

  useEffect(() => {
    const raw = value.trim().toUpperCase();
    if (!raw || !/^[A-Z][A-Z.]{0,7}$/.test(raw)) {
      setQuote(null);
      return;
    }
    const cached = getCachedQuote(raw);
    if (cached) setQuote(cached);
    let live = true;
    const t = window.setTimeout(() => {
      api
        .quote(raw)
        .then((q) => {
          if (!live) return;
          rememberQuote(q);
          setQuote(q);
        })
        .catch(() => {
          if (!live || cached) return;
          setQuote(null);
        });
    }, 280);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    onQuote?.(quote);
  }, [quote, onQuote]);

  const pick = (hit: SearchHit) => {
    onChange(hit.symbol.toUpperCase());
    const preview = partialFromSearch(hit);
    if (hit.exchange) preview.exchange = hit.exchange;
    rememberQuote(preview);
    setQuote(preview);
    setHits([]);
    setOpen(false);
  };

  const cap = compact(quote?.market_cap);
  const vol = compact(quote?.volume);
  const meta = [quote?.exchange, quote?.sector, cap ? `Cap ${cap}` : null, vol ? `Vol ${vol}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="pf-search">
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setHits([]);
          }
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            pick(hits[0]);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 180);
        }}
      />
      {open && hits.length > 0 && (
        <div className="pf-hits" role="listbox">
          {hits.map((h) => (
            <button
              key={h.symbol}
              type="button"
              className="pf-hit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <span className="pf-hit-left">
                <b className="sym">{h.symbol}</b>
                <span className="muted">
                  {h.name}
                  {h.exchange ? ` · ${h.exchange}` : ""}
                </span>
              </span>
              <span className="pf-hit-right">
                <span className="px">{h.price != null ? money(h.price) : "—"}</span>
                <span className={cls(h.change_pct)}>{pct(h.change_pct)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {quote && (
        <div className="pf-quote">
          <div className="pf-quote-name">
            <b>{quote.symbol}</b> {quote.name}
          </div>
          <div className="pf-quote-px">
            <span>{money(quote.price)}</span>
            <span className={cls(quote.change_pct)}>{pct(quote.change_pct)}</span>
          </div>
          {meta && <div className="muted">{meta}</div>}
        </div>
      )}
    </div>
  );
}
