/** Selected-ticker quote poll. Daily TA stays on-demand. News polls default 60s. */

function readSec(raw: string | undefined, fallback: number, min = 2, max = 3600): number {
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < min) return fallback;
  return Math.min(sec, max);
}

export const LIVE_REFRESH_SEC = readSec(
  import.meta.env.VITE_LIVE_REFRESH_SEC
    ?? import.meta.env.ZINTOPIA_LIVE_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_LIVE_REFRESH_SEC
    ?? import.meta.env.UTOPIA_LIVE_REFRESH_SEC,
  10,
);
export const LIVE_REFRESH_MS = LIVE_REFRESH_SEC * 1000;

/** Stock charts, NAV chart, and portfolio performance. */
export const CHART_REFRESH_SEC = readSec(
  import.meta.env.VITE_CHART_REFRESH_SEC
    ?? import.meta.env.ZINTOPIA_CHART_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_CHART_REFRESH_SEC
    ?? import.meta.env.UTOPIA_CHART_REFRESH_SEC,
  30,
);
export const CHART_REFRESH_MS = CHART_REFRESH_SEC * 1000;

/** Shared default for market tape + ticker news. Override one feed with MARKET/TICKER vars. */
export const NEWS_REFRESH_SEC = readSec(
  import.meta.env.VITE_NEWS_REFRESH_SEC
    ?? import.meta.env.ZINTOPIA_NEWS_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_NEWS_REFRESH_SEC
    ?? import.meta.env.UTOPIA_NEWS_REFRESH_SEC,
  60,
  10,
);
export const MARKET_NEWS_REFRESH_SEC = readSec(
  import.meta.env.VITE_MARKET_NEWS_REFRESH_SEC
    ?? import.meta.env.ZINTOPIA_MARKET_NEWS_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_MARKET_NEWS_REFRESH_SEC
    ?? import.meta.env.UTOPIA_MARKET_NEWS_REFRESH_SEC,
  NEWS_REFRESH_SEC,
  10,
);
export const TICKER_NEWS_REFRESH_SEC = readSec(
  import.meta.env.VITE_TICKER_NEWS_REFRESH_SEC
    ?? import.meta.env.ZINTOPIA_TICKER_NEWS_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_TICKER_NEWS_REFRESH_SEC
    ?? import.meta.env.UTOPIA_TICKER_NEWS_REFRESH_SEC,
  NEWS_REFRESH_SEC,
  10,
);
export const MARKET_NEWS_REFRESH_MS = MARKET_NEWS_REFRESH_SEC * 1000;
export const TICKER_NEWS_REFRESH_MS = TICKER_NEWS_REFRESH_SEC * 1000;

export function fmtRefreshSec(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}
