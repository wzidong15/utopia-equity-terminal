import { api } from "./api";
import { CHART_REFRESH_MS } from "./config";
import type { Bar } from "./types";

type Entry = { bars: Bar[]; at: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Bar[]>>();

function ttlFor(range: string) {
  const fresh = Math.max(1000, Math.round(CHART_REFRESH_MS * 0.4));
  if (range === "1d" || range === "5d") return fresh;
  if (range === "1mo") return Math.max(fresh, Math.round(CHART_REFRESH_MS * 0.8));
  return Math.max(CHART_REFRESH_MS, 15_000);
}

function key(symbol: string, range: string) {
  return `${symbol.trim().toUpperCase()}:${range}`;
}

export function getCachedBars(symbol: string, range: string): Bar[] | undefined {
  const hit = cache.get(key(symbol, range));
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlFor(range)) {
    cache.delete(key(symbol, range));
    return undefined;
  }
  return hit.bars;
}

export function rememberBars(symbol: string, range: string, bars: Bar[]) {
  if (!bars.length) return;
  cache.set(key(symbol, range), { bars, at: Date.now() });
}

export function fetchBars(symbol: string, range: string, opts?: { force?: boolean }): Promise<Bar[]> {
  const sym = symbol.trim().toUpperCase();
  const k = key(sym, range);
  if (!opts?.force) {
    const cached = getCachedBars(sym, range);
    if (cached) return Promise.resolve(cached);
  }

  const pending = inflight.get(k);
  if (pending) return pending;

  const req = api
    .history(sym, range)
    .then((h) => {
      rememberBars(sym, range, h.bars);
      return h.bars;
    })
    .finally(() => {
      inflight.delete(k);
    });
  inflight.set(k, req);
  return req;
}

export function prefetchBars(symbol: string, range: string) {
  if (getCachedBars(symbol, range) || inflight.has(key(symbol, range))) return;
  fetchBars(symbol, range).catch(() => undefined);
}
