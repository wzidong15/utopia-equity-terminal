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

function dayKey(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function overlapPairs(primary: Bar[], bench: Bar[]): { time: number; stock: number; bench: number }[] {
  const byTime = new Map<number, number>();
  const byDay = new Map<string, number>();
  for (const b of bench) {
    if (b.close == null || !Number.isFinite(b.close) || b.close === 0 || b.time == null) continue;
    byTime.set(b.time, b.close);
    byDay.set(dayKey(b.time), b.close);
  }
  const pairs: { time: number; stock: number; bench: number }[] = [];
  for (const p of primary) {
    if (p.close == null || !Number.isFinite(p.close) || p.time == null) continue;
    const bc = byTime.get(p.time) ?? byDay.get(dayKey(p.time));
    if (bc == null || bc === 0) continue;
    pairs.push({ time: p.time, stock: p.close, bench: bc });
  }
  return pairs;
}

/** Rebase `bench` onto the primary's first overlapping close (TradingView-style compare). */
export function scaleToPrimary(primary: Bar[], bench: Bar[]): OverlayPoint[] {
  const pairs = overlapPairs(primary, bench);
  if (pairs.length < 2) return [];
  const baseS = pairs[0].stock;
  const baseB = pairs[0].bench;
  if (!baseB) return [];
  return pairs.map((x) => ({
    time: x.time as UTCTimestamp,
    value: baseS * (x.bench / baseB),
  }));
}

/** Primary vs bench window return: (s1/s0) / (b1/b0) - 1. */
export function relativeReturn(primary: Bar[], bench: Bar[]): number | null {
  const pairs = overlapPairs(primary, bench);
  if (pairs.length < 2) return null;
  const s0 = pairs[0].stock;
  const b0 = pairs[0].bench;
  const s1 = pairs[pairs.length - 1].stock;
  const b1 = pairs[pairs.length - 1].bench;
  if (!s0 || !b0 || !b1) return null;
  const rel = s1 / s0 / (b1 / b0) - 1;
  return Number.isFinite(rel) ? rel : null;
}
