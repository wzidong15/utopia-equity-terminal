import type { Quote } from "./types";

const cache = new Map<string, Quote>();

export function rememberQuotes(quotes: Quote[]) {
  for (const q of quotes) {
    const sym = q?.symbol?.trim().toUpperCase();
    if (sym) cache.set(sym, q);
  }
}

export function rememberQuote(q: Quote) {
  rememberQuotes([q]);
}

export function getCachedQuote(symbol: string): Quote | undefined {
  return cache.get(symbol.trim().toUpperCase());
}

export function partialFromSearch(hit: {
  symbol: string;
  name: string;
  price?: number;
  change_pct?: number;
}): Quote {
  const sym = hit.symbol.trim().toUpperCase();
  return {
    ticker: sym,
    symbol: sym,
    name: hit.name,
    price: hit.price ?? null,
    change_pct: hit.change_pct ?? null,
    change: null,
  };
}
