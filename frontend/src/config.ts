/** Selected-ticker price + chart poll interval. News and Daily TA stay on-demand. */

function readRefreshSec(): number {
  const raw = import.meta.env.VITE_LIVE_REFRESH_SEC ?? import.meta.env.UTOPIA_LIVE_REFRESH_SEC ?? "10";
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 2) return 10;
  return Math.min(sec, 300);
}

export const LIVE_REFRESH_SEC = readRefreshSec();
export const LIVE_REFRESH_MS = LIVE_REFRESH_SEC * 1000;
