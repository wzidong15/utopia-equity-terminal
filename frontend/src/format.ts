import type { Profile, Quote } from "./types";

export function fmt(n?: number | null, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

export function fmtInt(n?: number | null) {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function pct(n?: number | null) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function cls(n?: number | null) {
  if (n == null) return "";
  return n >= 0 ? "up" : "down";
}

export function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function dividendYieldPct(quote: Quote | null, profile: Profile | null): number | null {
  if (quote?.dividend_yield != null && Number.isFinite(quote.dividend_yield)) {
    const n = quote.dividend_yield;
    if ((quote.source || "").includes("yfinance") && n <= 1) return n * 100;
    return n;
  }
  const y = numish(profile?.dividendYield);
  if (y == null) return null;
  return y <= 1 ? y * 100 : y;
}

export function fmtEarnings(ts: unknown): string {
  const n = numish(ts);
  if (n == null) return "—";
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export function rvol(q: Quote): number | null {
  const avg = q.avg_volume;
  if (q.volume == null || avg == null || avg <= 0) return null;
  return q.volume / avg;
}
