import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "./types";

export default function Chart({ bars }: { bars: Bar[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);

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
      timeScale: { borderColor: "#30363d", timeVisible: true },
      crosshair: { horzLine: { color: "#56d364" }, vertLine: { color: "#56d364" } },
    });
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
    const ro = new ResizeObserver(() => {
      if (!host.current) return;
      c.applyOptions({ width: host.current.clientWidth, height: host.current.clientHeight });
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      c.remove();
      chart.current = null;
    };
  }, []);

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
    candle.current.setData(data);
    volume.current.setData(vols);
    chart.current?.timeScale().fitContent();
  }, [bars]);

  return <div className="chart" ref={host} />;
}
