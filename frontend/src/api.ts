import type { DeepAnalysis } from "./deep";
import type { Bar, NewsItem, Profile, Quote, TA } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  snapshot: () =>
    getJson<{
      indices: Quote[];
      gainers: Quote[];
      losers: Quote[];
      active: Quote[];
      as_of: number;
    }>("/api/snapshot"),
  quote: (symbol: string) => getJson<Quote>(`/api/quote/${encodeURIComponent(symbol)}`),
  quotes: (symbols: string[]) =>
    getJson<{ items: Quote[] }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  movers: (kind: "gainers" | "losers" | "active") =>
    getJson<{ items: Quote[] }>(`/api/movers?kind=${kind}`),
  history: (symbol: string, range: string) =>
    getJson<{ bars: Bar[]; interval: string; source: string }>(
      `/api/history/${encodeURIComponent(symbol)}?range=${range}`,
    ),
  profile: (symbol: string) => getJson<Profile>(`/api/profile/${encodeURIComponent(symbol)}`),
  news: (symbol: string) =>
    getJson<{ items: NewsItem[] }>(`/api/news/${encodeURIComponent(symbol)}`),
  ta: (symbol: string) => getJson<TA>(`/api/ta/${encodeURIComponent(symbol)}?interval=1d`),
  deep: (symbol: string) => getJson<DeepAnalysis>(`/api/deep/${encodeURIComponent(symbol)}`),
  search: (q: string) =>
    getJson<{
      items: { symbol: string; name: string; exchange?: string; price?: number; change_pct?: number }[];
    }>(`/api/search?q=${encodeURIComponent(q)}`),
};
