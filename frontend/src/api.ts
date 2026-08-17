import type { DeepAnalysis } from "./deep";
import type { LlmAdviceResponse } from "./llm";
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
  indices: () => getJson<{ items: Quote[] }>("/api/indices"),
  snapshot: () =>
    getJson<{
      indices: Quote[];
      gainers: Quote[];
      losers: Quote[];
      active: Quote[];
      as_of: number;
      errors?: Record<string, string>;
    }>("/api/snapshot"),
  quote: (symbol: string) => getJson<Quote>(`/api/quote/${encodeURIComponent(symbol)}`),
  quotes: (symbols: string[]) =>
    getJson<{ items: Quote[] }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  movers: (kind: "gainers" | "losers" | "active") =>
    getJson<{ kind: string; items: Quote[]; error?: string }>(`/api/movers?kind=${kind}`),
  history: (symbol: string, range: string) =>
    getJson<{ bars: Bar[]; interval: string; source: string }>(
      `/api/history/${encodeURIComponent(symbol)}?range=${range}`,
    ),
  profile: (symbol: string) => getJson<Profile>(`/api/profile/${encodeURIComponent(symbol)}`),
  news: (symbol: string) =>
    getJson<{ items: NewsItem[] }>(`/api/news/${encodeURIComponent(symbol)}`),
  ta: (symbol: string) => getJson<TA>(`/api/ta/${encodeURIComponent(symbol)}?interval=1d`),
  deep: (symbol: string) => getJson<DeepAnalysis>(`/api/deep/${encodeURIComponent(symbol)}`),
  llmAdvice: (symbol: string): Promise<LlmAdviceResponse> =>
    fetch(`/api/llm-advice/${encodeURIComponent(symbol)}`, { method: "POST" }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json() as Promise<LlmAdviceResponse>;
    }),
  search: (q: string) =>
    getJson<{
      items: { symbol: string; name: string; exchange?: string; price?: number; change_pct?: number }[];
    }>(`/api/search?q=${encodeURIComponent(q)}`),
};
