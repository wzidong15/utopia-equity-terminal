import type { UTCTimestamp } from "lightweight-charts";
import type { Bar } from "./types";

export type OverlayPoint = { time: UTCTimestamp; value: number };

function closes(bars: Bar[]): { time: UTCTimestamp; close: number }[] {
  return bars
    .filter((b) => b.close != null && Number.isFinite(b.close) && b.time != null)
    .map((b) => ({ time: b.time as UTCTimestamp, close: b.close as number }));
}

export function rollingSma(bars: Bar[], period: number): OverlayPoint[] {
  const rows = closes(bars);
  if (period < 1 || rows.length < period) return [];
  const out: OverlayPoint[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].close;
    if (i >= period) sum -= rows[i - period].close;
    if (i >= period - 1) out.push({ time: rows[i].time, value: sum / period });
  }
  return out;
}

function vwapFrom(bars: Bar[]): OverlayPoint[] {
  const out: OverlayPoint[] = [];
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    if (b.high == null || b.low == null || b.close == null || b.time == null) continue;
    const v = b.volume ?? 0;
    if (v <= 0) continue;
    const typical = ((b.high as number) + (b.low as number) + (b.close as number)) / 3;
    pv += typical * v;
    vol += v;
    if (vol > 0) out.push({ time: b.time as UTCTimestamp, value: pv / vol });
  }
  return out;
}

/** Session VWAP for a 1D chart: regular hours when those bars exist, otherwise all bars. */
export function sessionVwap(bars: Bar[]): OverlayPoint[] {
  const rth = bars.filter((b) => b.session !== "pre" && b.session !== "post");
  const fromRth = vwapFrom(rth.length ? rth : bars);
  if (fromRth.length) return fromRth;
  return vwapFrom(bars);
}

export function lastValue(points: OverlayPoint[]): number | null {
  if (!points.length) return null;
  const v = points[points.length - 1].value;
  return Number.isFinite(v) ? v : null;
}
