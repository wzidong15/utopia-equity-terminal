/** Selected-ticker quote poll. News and Daily TA stay on-demand. */

function readSec(raw: string | undefined, fallback: number, min = 2, max = 3600): number {
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < min) return fallback;
  return Math.min(sec, max);
}

export const LIVE_REFRESH_SEC = readSec(
  import.meta.env.VITE_LIVE_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_LIVE_REFRESH_SEC
    ?? import.meta.env.UTOPIA_LIVE_REFRESH_SEC,
  10,
);
export const LIVE_REFRESH_MS = LIVE_REFRESH_SEC * 1000;

/** Stock charts, NAV chart, and portfolio performance. */
export const CHART_REFRESH_SEC = readSec(
  import.meta.env.VITE_CHART_REFRESH_SEC
    ?? import.meta.env.FINTOPIA_CHART_REFRESH_SEC
    ?? import.meta.env.UTOPIA_CHART_REFRESH_SEC,
  30,
);
export const CHART_REFRESH_MS = CHART_REFRESH_SEC * 1000;
