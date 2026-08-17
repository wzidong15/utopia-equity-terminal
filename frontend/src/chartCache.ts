import { api } from "./api";
import type { Bar } from "./types";

type Entry = { bars: Bar[]; at: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Bar[]>>();

const TTL_MS: Record<string, number> = {
  "1d": 30_000,
  "5d": 45_000,
};

function ttlFor(range: string) {
  return TTL_MS[range] ?? 120_000;
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

export function fetchBars(symbol: string, range: string): Promise<Bar[]> {
  const sym = symbol.trim().toUpperCase();
  const k = key(sym, range);
  const cached = getCachedBars(sym, range);
  if (cached) return Promise.resolve(cached);

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
