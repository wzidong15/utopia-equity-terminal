import type { DeepAnalysis } from "./deep";
import type { LlmAdviceResponse } from "./llm";
import type { Portfolio, PortfolioStrategyKind, PortfolioSummary } from "./portfolio";
import type { Bar, NewsItem, Profile, Quote, TA } from "./types";

function errorFromBody(text: string, fallback: string) {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    /* raw text */
  }
  return text || fallback;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorFromBody(text, res.statusText));
  }
  return res.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorFromBody(text, res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    getJson<{
      ok: boolean;
      polygon: boolean;
      llm: { openai: boolean; anthropic: boolean; any: boolean };
    }>("/api/health"),
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
        throw new Error(errorFromBody(text, res.statusText));
      }
      return res.json() as Promise<LlmAdviceResponse>;
    }),
  search: (q: string) =>
    getJson<{
      items: { symbol: string; name: string; exchange?: string; price?: number; change_pct?: number }[];
    }>(`/api/search?q=${encodeURIComponent(q)}`),
  portfolios: () => getJson<{ items: PortfolioSummary[] }>("/api/portfolios"),
  portfolio: (id: string) => getJson<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}`),
  createPortfolio: (name: string, amount: number) =>
    sendJson<Portfolio>("/api/portfolios", "POST", { name, amount }),
  deletePortfolio: (id: string) =>
    sendJson<{ ok: boolean }>(`/api/portfolios/${encodeURIComponent(id)}`, "DELETE"),
  portfolioOrder: (
    id: string,
    body: { symbol: string; side: "buy" | "sell"; shares?: number; notional?: number },
  ) => sendJson<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}/orders`, "POST", body),
  setPortfolioStrategy: (
    id: string,
    body: { kind: PortfolioStrategyKind; auto: boolean; symbol: string },
  ) => sendJson<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}/strategy`, "PUT", body),
  tickPortfolio: (id: string, force = false) =>
    sendJson<Portfolio>(
      `/api/portfolios/${encodeURIComponent(id)}/tick${force ? "?force=true" : ""}`,
      "POST",
    ),
};
