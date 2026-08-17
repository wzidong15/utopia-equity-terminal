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
        background: { type: ColorType.Solid, color: "#0b0d10" },
        textColor: "#8b95a3",
        fontFamily: "IBM Plex Mono, monospace",
      },
      grid: {
        vertLines: { color: "#1a1f27" },
        horzLines: { color: "#1a1f27" },
      },
      rightPriceScale: { borderColor: "#242a33" },
      timeScale: { borderColor: "#242a33", timeVisible: true },
      crosshair: { horzLine: { color: "#3a4452" }, vertLine: { color: "#3a4452" } },
    });
    const candles = c.addCandlestickSeries({
      upColor: "#3dd68c",
      downColor: "#f0616d",
      borderVisible: false,
      wickUpColor: "#3dd68c",
      wickDownColor: "#f0616d",
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
      .map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open as number,
        high: b.high as number,
        low: b.low as number,
        close: b.close as number,
      }));
    const vols = bars.map((b) => ({
      time: b.time as UTCTimestamp,
      value: b.volume ?? 0,
      color: (b.close ?? 0) >= (b.open ?? 0) ? "rgba(61,214,140,0.35)" : "rgba(240,97,109,0.35)",
    }));
    candle.current.setData(data);
    volume.current.setData(vols);
    chart.current?.timeScale().fitContent();
  }, [bars]);

  return <div className="chart" ref={host} />;
}
