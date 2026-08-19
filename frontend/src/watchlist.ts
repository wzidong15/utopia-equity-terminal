const KEY = "fintopia.watchlist";
const LEGACY_KEY = "utopia.watchlist";

export const DEFAULT_WATCHLIST = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "JPM",
  "UNH",
  "XOM",
];

export function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return [...DEFAULT_WATCHLIST];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const clean = [...new Set(parsed.map((s) => s.trim().toUpperCase()).filter(Boolean))];
      return clean.length ? clean : [...DEFAULT_WATCHLIST];
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_WATCHLIST];
}

export function saveWatchlist(symbols: string[]) {
  localStorage.setItem(KEY, JSON.stringify(symbols));
}

export function removeFromWatchlist(symbols: string[], symbol: string): string[] {
  const sym = symbol.trim().toUpperCase();
  return symbols.filter((s) => s !== sym);
}

export function toggleWatchlistSymbol(symbols: string[], symbol: string): string[] {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return symbols;
  if (symbols.includes(sym)) return symbols.filter((s) => s !== sym);
  return [...symbols, sym];
}
