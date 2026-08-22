import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { lastValue, rollingSma, sessionVwap, type OverlayPoint } from "./chartOverlays";
import { formatChartTick, formatChartTime } from "./format";
import type { Bar } from "./types";

const SMA20 = "#58A6FF";
const SMA50 = "#D2A8FF";
const SMA200 = "#FFA657";
const VWAP = "#E6EDF3";
const COMPARE = "#F0883E";

type OverlayId = "sma20" | "sma50" | "sma200" | "vwap";

export default function Chart({
  bars,
  showVwap,
  focusHours,
  compare,
  compareLabel,
}: {
  bars: Bar[];
  showVwap?: boolean;
  focusHours?: number;
  compare?: OverlayPoint[];
  compareLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20 = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50 = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200 = useRef<ISeriesApi<"Line"> | null>(null);
  const vwap = useRef<ISeriesApi<"Line"> | null>(null);
  const compareLine = useRef<ISeriesApi<"Line"> | null>(null);
  const [on, setOn] = useState<Record<OverlayId, boolean>>({
    sma20: true,
    sma50: true,
    sma200: true,
    vwap: true,
  });
  const [last, setLast] = useState<Record<OverlayId, number | null>>({
    sma20: null,
    sma50: null,
    sma200: null,
    vwap: null,
  });

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#161b22" },
        textColor: "#8b949e",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      },
      grid: {
        vertLines: { color: "#21262d" },
        horzLines: { color: "#21262d" },
      },
      rightPriceScale: { borderColor: "#30363d" },
      localization: { timeFormatter: formatChartTime },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        rightOffset: 3,
        tickMarkFormatter: formatChartTick,
      },
      crosshair: { horzLine: { color: "#56d364" }, vertLine: { color: "#56d364" } },
    });
    const lineOpts = {
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    const candles = c.addCandlestickSeries({
      upColor: "#56d364",
      downColor: "#f85149",
      borderVisible: false,
      wickUpColor: "#56d364",
      wickDownColor: "#f85149",
    });
    const vols = c.addHistogramSeries({
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    chart.current = c;
    candle.current = candles;
    volume.current = vols;
    sma20.current = c.addLineSeries({ color: SMA20, lineWidth: 1, ...lineOpts });
    sma50.current = c.addLineSeries({ color: SMA50, lineWidth: 1, ...lineOpts });
    sma200.current = c.addLineSeries({ color: SMA200, lineWidth: 1, ...lineOpts });
    vwap.current = c.addLineSeries({
      color: VWAP,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      ...lineOpts,
    });
    compareLine.current = c.addLineSeries({
      color: COMPARE,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    const ro = new ResizeObserver(() => {
      if (!host.current) return;
      c.applyOptions({ width: host.current.clientWidth, height: host.current.clientHeight });
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      c.remove();
      chart.current = null;
      candle.current = null;
      volume.current = null;
      sma20.current = null;
      sma50.current = null;
      sma200.current = null;
      vwap.current = null;
      compareLine.current = null;
    };
  }, []);

  useEffect(() => {
    sma20.current?.applyOptions({ visible: on.sma20 });
    sma50.current?.applyOptions({ visible: on.sma50 });
    sma200.current?.applyOptions({ visible: on.sma200 });
    vwap.current?.applyOptions({ visible: on.vwap && !!showVwap });
  }, [on, showVwap]);

  useEffect(() => {
    if (!candle.current || !volume.current) return;
    const data = bars
      .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null)
      .map((b) => {
        const ext = b.session === "pre" || b.session === "post";
        const up = ext ? "#58a6ff" : "#56d364";
        const down = ext ? "#d29922" : "#f85149";
        const bull = (b.close as number) >= (b.open as number);
        const color = bull ? up : down;
        return {
          time: b.time as UTCTimestamp,
          open: b.open as number,
          high: b.high as number,
          low: b.low as number,
          close: b.close as number,
          color,
          wickColor: color,
          borderColor: color,
        };
      });
    const vols = bars.map((b) => {
      const ext = b.session === "pre" || b.session === "post";
      const bull = (b.close ?? 0) >= (b.open ?? 0);
      return {
        time: b.time as UTCTimestamp,
        value: b.volume ?? 0,
        color: ext
          ? bull
            ? "rgba(88,166,255,0.35)"
            : "rgba(210,153,34,0.35)"
          : bull
            ? "rgba(86,211,100,0.35)"
            : "rgba(248,81,73,0.35)",
      };
    });
    const s20 = rollingSma(bars, 20);
    const s50 = rollingSma(bars, 50);
    const s200 = rollingSma(bars, 200);
    const vw = showVwap ? sessionVwap(bars) : [];
    candle.current.setData(data);
    volume.current.setData(vols);
    sma20.current?.setData(s20);
    sma50.current?.setData(s50);
    sma200.current?.setData(s200);
    vwap.current?.setData(vw);
    compareLine.current?.setData(compare && compare.length ? compare : []);
    compareLine.current?.applyOptions({
      visible: !!(compare && compare.length),
      title: compareLabel || "",
    });
    setLast({
      sma20: lastValue(s20),
      sma50: lastValue(s50),
      sma200: lastValue(s200),
      vwap: lastValue(vw),
    });
    const scale = chart.current?.timeScale();
    if (!scale) return;
    if (focusHours && data.length) {
      const lastTime = data[data.length - 1].time as number;
      const cutoff = lastTime - focusHours * 3600;
      let from = 0;
      while (from < data.length && (data[from].time as number) < cutoff) from += 1;
      const to = data.length - 1;
      try {
        // Logical range keeps the newest 1m bar in view (time-range `to: last`
        // clips it, so 1H/3H looked frozen while 1D fitContent still moved).
        scale.setVisibleLogicalRange({ from: Math.max(0, from) - 0.2, to: to + 2 });
      } catch {
        scale.fitContent();
      }
    } else {
      scale.fitContent();
    }
  }, [bars, showVwap, focusHours, compare, compareLabel]);

  const toggle = (id: OverlayId) => setOn((prev) => ({ ...prev, [id]: !prev[id] }));
  const fmt = (n: number | null) =>
    n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  return (
    <>
      <div className="chart" ref={host} />
      <div className="chart-legend" role="group" aria-label="Chart overlays">
        <button
          type="button"
          className={`chart-ov ${on.sma20 ? "on" : "off"}`}
          style={{ color: SMA20 } as CSSProperties}
          onClick={() => toggle("sma20")}
          disabled={last.sma20 == null}
        >
          SMA 20 {fmt(last.sma20)}
        </button>
        <button
          type="button"
          className={`chart-ov ${on.sma50 ? "on" : "off"}`}
          style={{ color: SMA50 } as CSSProperties}
          onClick={() => toggle("sma50")}
          disabled={last.sma50 == null}
        >
          SMA 50 {fmt(last.sma50)}
        </button>
        <button
          type="button"
          className={`chart-ov ${on.sma200 ? "on" : "off"}`}
          style={{ color: SMA200 } as CSSProperties}
          onClick={() => toggle("sma200")}
          disabled={last.sma200 == null}
        >
          SMA 200 {fmt(last.sma200)}
        </button>
        {showVwap && (
          <button
            type="button"
            className={`chart-ov ${on.vwap ? "on" : "off"}`}
            style={{ color: VWAP } as CSSProperties}
            onClick={() => toggle("vwap")}
            disabled={last.vwap == null}
          >
            VWAP {fmt(last.vwap)}
          </button>
        )}
        {compare && compare.length > 0 && (
          <span className="chart-ov on" style={{ color: COMPARE, cursor: "default" } as CSSProperties}>
            {compareLabel || "vs"} {fmt(lastValue(compare))}
          </span>
        )}
      </div>
    </>
  );
}
