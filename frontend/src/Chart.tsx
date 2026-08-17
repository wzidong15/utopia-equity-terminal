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
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#656d76",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      },
      grid: {
        vertLines: { color: "#eaeef2" },
        horzLines: { color: "#eaeef2" },
      },
      rightPriceScale: { borderColor: "#d0d7de" },
      timeScale: { borderColor: "#d0d7de", timeVisible: true },
      crosshair: { horzLine: { color: "#0969da" }, vertLine: { color: "#0969da" } },
    });
    const candles = c.addCandlestickSeries({
      upColor: "#1a7f37",
      downColor: "#cf222e",
      borderVisible: false,
      wickUpColor: "#1a7f37",
      wickDownColor: "#cf222e",
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
      color: (b.close ?? 0) >= (b.open ?? 0) ? "rgba(26,127,55,0.35)" : "rgba(207,34,46,0.35)",
    }));
    candle.current.setData(data);
    volume.current.setData(vols);
    chart.current?.timeScale().fitContent();
  }, [bars]);

  return <div className="chart" ref={host} />;
}
